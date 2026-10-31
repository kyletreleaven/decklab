import { useEffect, useState } from "react";
import { addCopies, ALL_MAGIC, assetTree, moveLines, pullSheet, type AssetNode, type PullRow, type PullSource } from "../lib/assets";
import { cardStore, execute, select } from "../lib/db";
import { isA } from "../lib/ontology";
import { useRetained } from "../lib/panelState";

/**
 * What a deck lacks, a line a card, each with the buckets in a collection
 * that would fill it and a ← to pull from one: the copies move from that
 * place into the deck's zone, keeping their own bucket, and a filled line
 * goes. The collection is the user's to name — a place, a sum, or All
 * Magic, which has every card and adds copies rather than moving them —
 * never "everywhere": which cards count is theirs to say. Local only.
 */
export function PullSheet({ deck, onClose, onChanged }: { deck: AssetNode; onClose: () => void; onChanged: () => void }) {
  const lab = { select, execute };
  const [from, setFrom] = useRetained<string>("pull-sheet", "from", "");
  const [collections, setCollections] = useState<AssetNode[]>([]);
  const [rows, setRows] = useState<PullRow[] | null>(null);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [chosen, setChosen] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  // Every place and sum but this deck and what is in it.
  useEffect(() => {
    void assetTree(lab).then((tree) => {
      const out: AssetNode[] = [];
      const walk = (ns: AssetNode[]) => {
        for (const n of ns) {
          if (n.id === deck.id) continue;
          if (n.type === "place" || isA(n.type, "sum")) out.push(n);
          walk(n.children);
        }
      };
      walk(tree);
      setCollections(out);
      if (from && from !== ALL_MAGIC && !out.some((c) => c.id === from)) setFrom("");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.id]);

  useEffect(() => {
    if (!from) {
      setRows(null);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const store = await cardStore();
        const next = await pullSheet(lab, store, deck.id, from);
        // Each source's printing, said as set and number.
        const ids = [...new Set(next.flatMap((r) => r.sources.map((s) => s.bucket.printingId ?? s.bucket.shownId)).filter(Boolean))] as string[];
        const named = new Map<string, string>();
        for (let i = 0; i < ids.length; i += 400) {
          const chunk = ids.slice(i, i + 400);
          const found = await store.select<{ id: string; set_code: string; collector_number: string }>(
            `SELECT id, set_code, collector_number FROM cards WHERE id IN (${chunk.map((_, j) => `$${j + 1}`).join(", ")})`,
            chunk,
          );
          for (const f of found) named.set(f.id, `${f.set_code.toUpperCase()} ${f.collector_number}`);
        }
        if (!live) return;
        setLabels(named);
        setRows(next);
        setChosen(new Map());
        setError(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.id, from, version]);

  const key = (r: PullRow) => `${r.zone}|${r.oracleId}`;
  const label = (s: PullSource) => {
    const b = s.bucket;
    const all = s.place.id === ALL_MAGIC;
    // From a place, what a copy is known to be; from All Magic, what the line asks.
    const shown = b.shownId && (labels.get(b.shownId) ?? "?");
    const printing = b.printingId
      ? (labels.get(b.printingId) ?? "printing")
      : all
        ? shown ? `any printing, drawn as ${shown}` : "any printing"
        : shown ? `not recorded, likely ${shown}` : "printing not recorded";
    const extra = [b.finish, ...Object.entries(b.attrs ?? {}).map(([k, v]) => (v === true ? k : `${k} ${String(v)}`))].filter(Boolean);
    return `${s.place.name} › ${[printing, ...extra].join(" · ")}${all ? "" : ` (×${s.qty})`}`;
  };

  /** Pull from each row its chosen source, as many as it lacks or the source has. */
  const pull = async (which: PullRow[]) => {
    setBusy(true);
    try {
      for (const r of which) {
        const s = r.sources[chosen.get(key(r)) ?? 0];
        if (!s || !r.zoneId) continue;
        const n = Math.min(r.missing, s.qty);
        if (s.place.id === ALL_MAGIC) await addCopies(lab, r.zoneId, s.bucket, n);
        else await moveLines(lab, null, { assetId: s.place.id, bucket: s.bucket }, { assetId: r.zoneId, bucket: s.bucket }, n);
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setVersion((v) => v + 1);
    }
  };

  const pullable = (rows ?? []).filter((r) => r.sources.length && r.zoneId);
  const absent = (rows ?? []).filter((r) => !r.sources.length);
  const source = from === ALL_MAGIC ? { name: "All Magic" } : collections.find((c) => c.id === from);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide pull-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Pull into {deck.name}</h3>
        <div className="field">
          <label>From</label>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose a collection…</option>
            <option value={ALL_MAGIC}>All Magic: every card, as the decklist says</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                /{c.path.join("/")}
              </option>
            ))}
          </select>
        </div>

        {error && <div className="status error">{error}</div>}
        {from && rows === null && !error && <span className="hint">Reading…</span>}
        {rows && rows.length === 0 && <span className="hint">Nothing missing: the deck holds what its decklist asks.</span>}

        {pullable.length > 0 && (
          <div className="pull-rows">
            {pullable.map((r) => (
              <div key={key(r)} className="pull-row">
                <span className="pull-qty">{r.missing}×</span>
                <span className="pull-name">
                  {r.card.name}
                  {r.zone !== "main" && <span className="hint"> · {r.zone}</span>}
                </span>
                <select
                  value={chosen.get(key(r)) ?? 0}
                  disabled={busy}
                  onChange={(e) => setChosen((m) => new Map(m).set(key(r), Number(e.target.value)))}
                >
                  {r.sources.map((s, i) => (
                    <option key={i} value={i}>
                      {label(s)}
                    </option>
                  ))}
                </select>
                <button title="Pull from there into the deck" disabled={busy} onClick={() => void pull([r])}>
                  ←
                </button>
              </div>
            ))}
          </div>
        )}
        {rows && rows.some((r) => r.sources.length && !r.zoneId) && (
          <span className="hint">Some cards are for a zone this deck does not have yet.</span>
        )}
        {absent.length > 0 && source && (
          <span className="hint">
            Not in {source.name}: {absent.map((r) => r.card.name).join(", ")}.
          </span>
        )}

        <div className="actions">
          <button onClick={onClose}>Close</button>
          <button className="primary" disabled={busy || !pullable.length} onClick={() => void pull(pullable)}>
            Pull all
          </button>
        </div>
      </div>
    </div>
  );
}
