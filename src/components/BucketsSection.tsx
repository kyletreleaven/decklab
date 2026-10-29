import { useEffect, useState } from "react";
import {
  bucketKey,
  bucketsOf,
  CONDITIONS,
  type Bucket,
} from "../lib/assets";
import { select, execute } from "../lib/db";
import type { AssetType } from "../lib/ontology";
import { printingLabel } from "../lib/printings";
import * as scryfall from "../lib/scryfall";
import type { Card } from "../lib/types";
import { BucketButtons, type LabTarget } from "./AssetView";

/** Finishes to offer when the printing is not known. */
const ANY_FINISHES = ["nonfoil", "foil", "etched"];

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
  /** Move n from one bucket of the source to another. */
  onMove: (from: Bucket, to: Bucket, n: number) => Promise<void>;
}) {
  const [rows, setRows] = useState<{ bucket: Bucket; qty: number }[] | null>(null);
  const [runs, setRuns] = useState<Card[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    bucketsOf({ select, execute }, source, oracleId).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [source.id, source.type, oracleId, version]);

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

  const pool = source.type === "list pool";
  const byId = new Map(runs.map((c) => [c.id, c]));
  const unknown = pool || source.type !== "place" ? "any printing" : "printing not recorded";
  const label = (b: Bucket) => {
    const c = b.printingId ? byId.get(b.printingId) : undefined;
    const printing = b.printingId ? (c ? printingLabel(c) : b.printingId) : unknown;
    const attrs = Object.entries(b.attrs ?? {}).map(([k, v]) =>
      v === true ? k : v === false ? `not ${k}` : `${k} ${String(v)}`,
    );
    return [printing, b.finish, ...attrs].filter(Boolean).join(" · ");
  };

  return (
    <div className="buckets">
      <div className="buckets-head">
        In <strong>{source.name}</strong>
      </div>
      {rows?.length === 0 && <div className="hint">None left here.</div>}
      {rows?.map(({ bucket, qty }) => {
        const k = bucketKey(bucket);
        return (
          <div key={k} className="bucket-row">
            <div className="bucket-line">
              {!pool && <span className="bucket-qty">{qty}×</span>}
              <span className="bucket-label">{label(bucket)}</span>
              {target && (
                <BucketButtons
                  bucket={bucket}
                  source={source}
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
                  await onMove(bucket, to, n);
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
  const [printingId, setPrintingId] = useState(from.printingId ?? "");
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
    ...(printingId && { printingId }),
    ...(finish && { finish }),
    attrs: nextAttrs,
  };
  const same = bucketKey(to) === bucketKey(from);
  const nOk = Number.isInteger(n) && n >= 1 && n <= qty;
  // A printing no longer in the run (or not yet loaded) still shows as itself.
  const options = from.printingId && !runs.some((c) => c.id === from.printingId)
    ? [{ id: from.printingId, label: from.printingId }]
    : [];

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
