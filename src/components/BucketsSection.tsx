import { useEffect, useState } from "react";
import {
  bucketKey,
  bucketsOf,
  CONDITIONS,
  type Bucket,
  type Place,
} from "../lib/assets";
import { select, execute } from "../lib/db";
import { useRetained } from "../lib/panelState";
import type { AssetType } from "../lib/ontology";
import { printingLabel } from "../lib/printings";
import * as scryfall from "../lib/scryfall";
import type { Card } from "../lib/types";
import { BucketButtons, type LabTarget } from "./AssetView";

/** Finishes to offer when the printing is not known. */
const ANY_FINISHES = ["nonfoil", "foil", "etched"];

type Row = { bucket: Bucket; qty: number; place?: Place };

/** One card's buckets in an asset, read again when `version` moves; null while reading. */
function useBuckets(asset: { id: string; type: AssetType } | null, oracleId: string, version: number): Row[] | null {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let live = true;
    // No reset to null: an edit swaps the new rows in without a flash.
    if (!asset) setRows(null);
    else bucketsOf({ select, execute }, asset, oracleId).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [asset?.id, asset?.type, oracleId, version]);
  return rows;
}

/**
 * The card's print run, to say which printing a bucket is: the detail's
 * own (`scryfall.printings`, memoised), so this sends no request the
 * selection did not already send.
 */
function usePrintRun(oracleId: string): Card[] {
  const [runs, setRuns] = useState<Card[]>([]);
  useEffect(() => {
    let live = true;
    setRuns([]);
    scryfall.storedPrintings(oracleId).then((r) => live && r.length && setRuns(r));
    scryfall
      .printings(oracleId)
      .then((r) => live && r.length && setRuns(r))
      .catch(() => {}); // the detail's carousel says so
    return () => {
      live = false;
    };
  }, [oracleId]);
  return runs;
}

/** A bucket as a row says it: printing, finish, attributes; `unknown` for no printing. */
function labeller(runs: Card[], unknown: string): (b: Bucket) => string {
  const byId = new Map(runs.map((c) => [c.id, c]));
  return (b) => {
    const c = b.printingId ? byId.get(b.printingId) : undefined;
    const s = b.shownId ? byId.get(b.shownId) : undefined;
    const printing = b.printingId
      ? c ? printingLabel(c) : b.printingId
      : b.shownId
        ? `${unknown}, suggested ${s ? printingLabel(s) : b.shownId}`
        : unknown;
    const attrs = Object.entries(b.attrs ?? {}).map(([k, v]) =>
      v === true ? k : v === false ? `not ${k}` : `${k} ${String(v)}`,
    );
    return [printing, b.finish, ...attrs].filter(Boolean).join(" · ");
  };
}

/**
 * The selected card's buckets in the asset it was chosen from, one row each:
 * what it is, how many, the target's buttons for it — and *Change…*, which
 * moves n of it to another bucket (B′): set, change or clear its printing,
 * finish or attributes, all of it or a split. Moving onto a bucket already
 * there merges.
 *
 * Printings to choose from are the detail's own print run
 * (`scryfall.printings`, memoised): opening this sends no request the
 * selection did not already send.
 */
export function BucketsSection({
  source,
  oracleId,
  target,
  version,
  onMove,
}: {
  source: { id: string; type: AssetType; name: string };
  oracleId: string;
  target: LabTarget | null;
  /** Bumped by any edit, to read the buckets again. */
  version: number;
  /** Move n from one bucket to another, in `assetId`: the source, or in a sum the bucket's place. */
  onMove: (assetId: string, from: Bucket, to: Bucket, n: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const rows = useBuckets(source, oracleId, version);
  const runs = usePrintRun(oracleId);

  const pool = source.type === "list pool";
  const unknown =
    pool || (source.type !== "place" && source.type !== "sum") ? "any printing" : "printing not recorded";
  const label = labeller(runs, unknown);

  return (
    <div className="buckets">
      <div className="buckets-head">
        In <strong>{source.name}</strong>
      </div>
      {rows?.length === 0 && <div className="hint">None left here.</div>}
      {rows?.map(({ bucket, qty, place }) => {
        // In a sum, a bucket is its place's: the source of its buttons and moves.
        const from = place ? { id: place.id, type: "place" as const, name: place.name } : source;
        const k = `${from.id}:${bucketKey(bucket)}`;
        return (
          <div key={k} className="bucket-row">
            <div className="bucket-line">
              {place && <span className="bucket-place">{place.name}</span>}
              {!pool && <span className="bucket-qty">{qty}×</span>}
              <span className="bucket-label">{label(bucket)}</span>
              {target && (
                <BucketButtons
                  bucket={bucket}
                  source={from}
                  target={target}
                  className="bucket-buttons"
                />
              )}
              <button
                className="ghost"
                onClick={() => setEditing(editing === k ? null : k)}
              >
                {editing === k ? "Cancel" : "Change…"}
              </button>
            </div>
            {editing === k && (
              <BucketEditor
                from={bucket}
                qty={qty}
                pool={pool}
                runs={runs}
                unknown={unknown}
                onMove={async (to, n) => {
                  await onMove(from.id, bucket, to, n);
                  setEditing(null);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A collection to look in, as the picker lists it. */
export interface FindIn {
  id: string;
  type: AssetType;
  /** Its path, to tell two binders called Red apart. */
  label: string;
}

/**
 * Filling a missing slot of a deck (journey D step 3): the card's copies in
 * a collection you choose — required, nothing guessed — each with `←`,
 * which moves one, bucket and all, into the zone missing it. The choice is
 * kept per deck, as its search is. Read from the lab: no requests.
 */
export function FindSection({
  oracleId,
  deckId,
  into,
  collections,
  version,
  onTake,
}: {
  oracleId: string;
  deckId: string;
  /** The deck's zone the card is missing from: a place. */
  into: { id: string; name: string };
  collections: FindIn[];
  /** Bumped by any edit, to read the copies again. */
  version: number;
  /** Move one copy of `bucket` from the place `fromId` into `into`. Throws, to say why. */
  onTake: (fromId: string, bucket: Bucket) => Promise<void>;
}) {
  const [chosenId, setChosenId] = useRetained(`asset:${deckId}`, "findIn", "");
  const chosen = collections.find((c) => c.id === chosenId) ?? null;
  const rows = useBuckets(chosen, oracleId, version);
  const label = labeller(usePrintRun(oracleId), "printing not recorded");
  const [error, setError] = useState<string | null>(null);

  // A place chosen holds its rows itself; a sum's say which place. The zone
  // itself is no source, should the chosen sum hold the deck.
  const copies = (rows ?? [])
    .map((r) => ({ ...r, from: r.place ?? { id: chosen!.id, name: chosen!.label } }))
    .filter((r) => r.from.id !== into.id);

  return (
    <div className="buckets">
      <div className="buckets-head">
        Missing from <strong>{into.name}</strong>. Find it in{" "}
        <select
          value={chosen?.id ?? ""}
          onChange={(e) => {
            setChosenId(e.target.value);
            setError(null);
          }}
        >
          <option value="" disabled>
            choose a collection…
          </option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {!chosen && <div className="hint">Choose a collection to find this card in.</div>}
      {chosen && rows && copies.length === 0 && <div className="hint">None in {chosen.label}.</div>}
      {error && <div className="status error">{error}</div>}
      {chosen &&
        copies.map(({ bucket, qty, from }) => (
          <div key={`${from.id}:${bucketKey(bucket)}`} className="bucket-row">
            <div className="bucket-line">
              <span className="bucket-place">{from.name}</span>
              <span className="bucket-qty">{qty}×</span>
              <span className="bucket-label">{label(bucket)}</span>
              <span className="bucket-buttons">
                <button
                  title={`Move one from ${from.name} into ${into.name}`}
                  onClick={async () => {
                    setError(null);
                    try {
                      await onTake(from.id, bucket);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  ←
                </button>
              </span>
            </div>
          </div>
        ))}
    </div>
  );
}

/** A bucket's fields, editable: B′, and how many of B to move to it. */
function BucketEditor({
  from,
  qty,
  pool,
  runs,
  unknown,
  onMove,
}: {
  from: Bucket;
  qty: number;
  pool: boolean;
  runs: Card[];
  unknown: string;
  onMove: (to: Bucket, n: number) => Promise<void>;
}) {
  const [printingId, setPrintingId] = useState(from.printingId ?? from.shownId ?? "");
  // A printing is the bucket's own, or only how its copies are drawn
  // (docs/inventory/buckets.md → *Suggested printings*).
  const [bound, setBound] = useState(!from.shownId);
  const [finish, setFinish] = useState(from.finish ?? "");
  const attrs = from.attrs ?? {};
  const [condition, setCondition] = useState(String(attrs.condition ?? ""));
  const flag = (v: unknown) => (v === true ? "yes" : v === false ? "no" : "");
  const [signed, setSigned] = useState(flag(attrs.signed));
  const [altered, setAltered] = useState(flag(attrs.altered));
  const [note, setNote] = useState(String(attrs.note ?? ""));
  const [n, setN] = useState(qty);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = runs.find((c) => c.id === printingId);
  const finishes = (chosen?.data.finishes as string[] | undefined) ?? ANY_FINISHES;
  const badFinish = finish !== "" && !!chosen && !finishes.includes(finish);
  const asFlag = (v: string) => (v === "yes" ? true : v === "no" ? false : undefined);
  // Keys the fixed set does not cover are kept as they are.
  const { condition: _c, signed: _s, altered: _a, note: _n, ...others } = attrs;
  const nextAttrs = Object.fromEntries(
    Object.entries({
      ...others,
      condition: condition || undefined,
      signed: asFlag(signed),
      altered: asFlag(altered),
      note: note.trim() || undefined,
    }).filter(([, v]) => v !== undefined),
  );
  const to: Bucket = {
    oracleId: from.oracleId,
    ...(printingId && (bound ? { printingId } : { shownId: printingId })),
    ...(finish && { finish }),
    attrs: nextAttrs,
  };
  const same = bucketKey(to) === bucketKey(from);
  const nOk = Number.isInteger(n) && n >= 1 && n <= qty;
  // A printing no longer in the run (or not yet loaded) still shows as itself.
  const was = from.printingId ?? from.shownId;
  const options = was && !runs.some((c) => c.id === was) ? [{ id: was, label: was }] : [];

  return (
    <div className="bucket-editor">
      <label>
        Printing
        <select value={printingId} onChange={(e) => setPrintingId(e.target.value)}>
          <option value="">— {unknown}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
          {runs.map((c) => (
            <option key={c.id} value={c.id}>
              {printingLabel(c)}
            </option>
          ))}
        </select>
      </label>
      <label title="Bound: only this printing. Suggested: any printing, drawn as this one.">
        Printing is
        <select value={bound ? "bound" : "suggested"} disabled={!printingId} onChange={(e) => setBound(e.target.value === "bound")}>
          <option value="bound">bound</option>
          <option value="suggested">suggested</option>
        </select>
      </label>
      <label>
        Finish
        <select value={finish} onChange={(e) => setFinish(e.target.value)}>
          <option value="">— not recorded</option>
          {[...new Set([...finishes, ...(finish ? [finish] : [])])].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label>
        Condition
        <select value={condition} onChange={(e) => setCondition(e.target.value)}>
          <option value="">—</option>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {(
        [
          ["Signed", signed, setSigned],
          ["Altered", altered, setAltered],
        ] as const
      ).map(([name, v, set]) => (
        <label key={name}>
          {name}
          <select value={v} onChange={(e) => set(e.target.value)}>
            <option value="">—</option>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </label>
      ))}
      <label>
        Note
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {badFinish && (
        <div className="status error">
          {chosen!.setCode.toUpperCase()} {chosen!.collectorNumber} does not come {finish}.
        </div>
      )}
      {error && <div className="status error">{error}</div>}
      <div className="bucket-move">
        {!pool && (
          <label title={`How many of the ${qty} to change`}>
            Move
            <input
              type="number"
              min={1}
              max={qty}
              value={n}
              onChange={(e) => setN(Number(e.target.value))}
            />
            of {qty}
          </label>
        )}
        <span
          className="hint-wrap"
          title={same ? "Nothing changed" : !nOk ? `Between 1 and ${qty}` : "Move them to this bucket, merging with any there"}
        >
          <button
            disabled={same || badFinish || !nOk || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onMove(to, pool ? 1 : n);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {pool ? "Change" : n === qty ? "Change all" : `Change ${n}`}
          </button>
        </span>
      </div>
    </div>
  );
}
