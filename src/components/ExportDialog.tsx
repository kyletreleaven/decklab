import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import type { ExportFormat } from "../lib/decklist";

const FORMATS: { value: ExportFormat; label: string; extension: string }[] = [
  { value: "text", label: "Plain text", extension: "txt" },
  { value: "arena", label: "Arena (with set codes)", extension: "txt" },
  { value: "csv", label: "CSV", extension: "csv" },
];

export function ExportDialog({
  title,
  filenameBase,
  render,
  onClose,
}: {
  title: string;
  /** Used as the default filename, minus extension. */
  filenameBase: string;
  render: (format: ExportFormat) => string;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>("text");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const content = useMemo(() => render(format), [format, render]);
  const extension =
    FORMATS.find((f) => f.value === format)?.extension ?? "txt";

  // Keep the suggested filename filesystem-safe without mangling it further.
  const safeName = filenameBase.replace(/[/\\:*?"<>|]/g, "-").trim() || "export";

  async function saveToFile() {
    setError(null);
    try {
      const path = await save({
        defaultPath: `${safeName}.${extension}`,
        filters: [
          {
            name: format === "csv" ? "CSV" : "Text",
            extensions: [extension],
          },
        ],
      });
      if (!path) return;

      await invoke("write_text_file", { path, contents: content });
      setStatus(`Saved to ${path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function copy() {
    setError(null);
    try {
      await writeText(content);
      setStatus("Copied to clipboard.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const lineCount = content ? content.split("\n").length : 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h3>Export {title}</h3>

        <div className="field">
          <label>Format</label>
          <select
            value={format}
            onChange={(e) => {
              setFormat(e.target.value as ExportFormat);
              setStatus(null);
            }}
          >
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>
            Preview <span className="hint">({lineCount} lines)</span>
          </label>
          <textarea rows={14} readOnly value={content} spellCheck={false} />
        </div>

        {status && <span className="hint">{status}</span>}
        {error && (
          <div className="status error" style={{ borderBottom: "none" }}>
            {error}
          </div>
        )}

        <div className="actions">
          <button onClick={onClose}>Close</button>
          <button onClick={copy} disabled={!content}>
            Copy
          </button>
          <button className="primary" onClick={saveToFile} disabled={!content}>
            Save to file…
          </button>
        </div>
      </div>
    </div>
  );
}
