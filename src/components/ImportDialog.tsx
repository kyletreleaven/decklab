import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { parseDecklist, type ParsedLine } from "../lib/decklist";
import {
  importIntoCollection,
  importIntoDeck,
  resolveLines,
  type ImportPreview,
} from "../lib/importer";
import { importFromUrl, UrlImportError } from "../lib/urlimport";

type Tab = "paste" | "file" | "url";

export interface ImportTarget {
  kind: "deck" | "collection";
  id: string;
  name: string;
}

export function ImportDialog({
  target,
  onClose,
  onImported,
}: {
  target: ImportTarget;
  onClose: () => void;
  onImported: (added: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("paste");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  function fail(err: unknown) {
    if (err instanceof UrlImportError) {
      setError(err.message);
      setHint(err.hint ?? null);
    } else {
      setError(err instanceof Error ? err.message : String(err));
      setHint(null);
    }
  }

  async function resolve(lines: ParsedLine[], label: string) {
    if (!lines.length) {
      setError("Nothing deck-shaped was found.");
      setHint(null);
      return;
    }
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      setPreview(await resolveLines(lines));
      setSourceLabel(label);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function handlePaste() {
    const parsed = parseDecklist(text);
    await resolve(parsed.lines, parsed.source === "csv" ? "pasted CSV" : "pasted text");
  }

  async function handleFile() {
    setError(null);
    setHint(null);
    try {
      const path = await open({
        multiple: false,
        filters: [
          {
            name: "Decklist",
            extensions: ["txt", "csv", "dec", "dek", "mwdeck", "cod"],
          },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (typeof path !== "string") return;

      const contents = await invoke<string>("read_text_file", { path });
      setText(contents);
      const parsed = parseDecklist(contents);
      await resolve(parsed.lines, path.split("/").pop() ?? "file");
    } catch (err) {
      fail(err);
    }
  }

  async function handleUrl() {
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const result = await importFromUrl(url);
      setBusy(false);
      await resolve(result.lines, result.deckName ?? result.source);
    } catch (err) {
      setBusy(false);
      fail(err);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    try {
      const added =
        target.kind === "deck"
          ? await importIntoDeck(target.id, preview.resolved)
          : await importIntoCollection(target.id, preview.resolved);
      onImported(added);
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  }

  const unmatched = preview?.resolved.filter((r) => !r.card) ?? [];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h3>
          Import into {target.name}
          <span className="hint"> · {target.kind}</span>
        </h3>

        <div className="tabs">
          {(["paste", "file", "url"] as Tab[]).map((t) => (
            <button
              key={t}
              className={tab === t ? "on" : ""}
              onClick={() => {
                setTab(t);
                setPreview(null);
                setError(null);
                setHint(null);
              }}
            >
              {t === "paste" ? "Paste" : t === "file" ? "Open file" : "From URL"}
            </button>
          ))}
        </div>

        {!preview && (
          <>
            {tab === "paste" && (
              <div className="field">
                <label>Decklist or CSV</label>
                <textarea
                  rows={12}
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    "1 Sol Ring (C21) 263\n1 Arcane Signet\n\nCommander\n1 Atraxa, Praetors' Voice\n\n…or paste a CSV export."
                  }
                />
                <span className="hint">
                  Arena, MTGO, Moxfield, Archidekt and plain lists all work.
                </span>
              </div>
            )}

            {tab === "file" && (
              <div className="field">
                <label>File</label>
                <button onClick={handleFile}>Choose a file…</button>
                <span className="hint">
                  .txt, .csv or any decklist export you have downloaded.
                </span>
              </div>
            )}

            {tab === "url" && (
              <div className="field">
                <label>Deck URL</label>
                <input
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && url.trim()) handleUrl();
                  }}
                  placeholder="https://archidekt.com/decks/123456"
                />
                <span className="hint">
                  Archidekt is supported directly. Any URL serving a plain-text or
                  CSV export also works.
                </span>
              </div>
            )}
          </>
        )}

        {preview && (
          <div className="import-preview">
            <div className="preview-summary">
              <span className="owned">{preview.matched} matched</span>
              {preview.unmatched > 0 && (
                <span className="missing">{preview.unmatched} unmatched</span>
              )}
              <span className="hint">
                {preview.totalCards} card{preview.totalCards === 1 ? "" : "s"} from{" "}
                {sourceLabel}
              </span>
            </div>

            <div className="preview-list">
              {preview.resolved.map((row, i) => (
                <div key={i} className={`row ${row.card ? "" : "unmatched"}`}>
                  <span className="qty">{row.line.quantity}×</span>
                  <span className="name">{row.card?.name ?? row.line.name}</span>
                  <span className="meta">
                    {row.card
                      ? `${row.card.setCode.toUpperCase()} · ${row.line.section}`
                      : "not found"}
                  </span>
                </div>
              ))}
            </div>

            {unmatched.length > 0 && (
              <span className="hint">
                Unmatched lines are skipped; everything else still imports.
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="status error" style={{ borderBottom: "none" }}>
            {error}
            {hint && (
              <div className="hint" style={{ marginTop: 4 }}>
                {hint}
              </div>
            )}
          </div>
        )}

        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          {preview ? (
            <>
              <button onClick={() => setPreview(null)} disabled={busy}>
                Back
              </button>
              <button
                className="primary"
                onClick={commit}
                disabled={busy || preview.matched === 0}
              >
                {busy ? "Importing…" : `Import ${preview.matched} cards`}
              </button>
            </>
          ) : (
            <button
              className="primary"
              onClick={
                tab === "paste" ? handlePaste : tab === "url" ? handleUrl : handleFile
              }
              disabled={
                busy ||
                (tab === "paste" && !text.trim()) ||
                (tab === "url" && !url.trim())
              }
            >
              {busy ? "Reading…" : tab === "file" ? "Choose a file…" : "Preview"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
