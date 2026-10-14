"use client";

import { useEffect, useMemo, useState } from "react";
import { Table2 } from "lucide-react";
import type { PostMedia } from "@/lib/post-media";
import { PreviewCard, PreviewError, PreviewLoading, useProxiedBytes } from "./PreviewCard";

const MAX_ROWS = 200;
const MAX_COLS = 50;

/** XLSX / XLS / ODS via SheetJS — sheet tabs + a scrollable grid (first 200 rows). */
export default function SheetPreview({ media, defaultExpanded = true }: { media: PostMedia; defaultExpanded?: boolean }) {
  const { bytes, error } = useProxiedBytes(media.url);
  const [sheets, setSheets] = useState<Array<{ name: string; rows: string[][] }> | null>(null);
  const [active, setActive] = useState(0);
  const [parseError, setParseError] = useState("");

  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    (async () => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(bytes, { type: "array" });
        const out = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" }) as string[][];
          return { name, rows: rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS)) };
        });
        if (!cancelled) setSheets(out);
      } catch (err) {
        if (!cancelled) setParseError(err instanceof Error ? err.message : "Could not read spreadsheet");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  const sheet = sheets?.[active];
  const colCount = useMemo(() => (sheet ? Math.max(0, ...sheet.rows.map((r) => r.length)) : 0), [sheet]);

  return (
    <PreviewCard
 media={media}
 defaultExpanded={defaultExpanded} icon={Table2}>
      {error || parseError ? (
        <PreviewError message={error || parseError} />
      ) : !sheets ? (
        <PreviewLoading />
      ) : (
        <>
          {sheets.length > 1 && (
            <div className="flex gap-1 overflow-x-auto border-b border-[var(--border-color)] px-2 py-1.5">
              {sheets.map((s, i) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => setActive(i)}
                  className={[
                    "cursor-pointer whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold",
                    i === active ? "bg-[var(--accent-muted)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                  ].join(" ")}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <div className="max-h-[420px] overflow-auto">
            <table className="border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 border-b border-r border-[var(--border-color)] bg-[var(--bg-surface)] px-2 py-1 text-[var(--text-muted)]" />
                  {Array.from({ length: colCount }).map((_, c) => (
                    <th key={c} className="sticky top-0 z-10 border-b border-r border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1 text-center font-semibold text-[var(--text-muted)]">
                      {colName(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet?.rows.map((r, ri) => (
                  <tr key={ri} className="odd:bg-[var(--layer-1)]">
                    <td className="sticky left-0 border-b border-r border-[var(--border-color)] bg-[var(--bg-surface)] px-2 py-1 text-right text-[var(--text-muted)]">{ri + 1}</td>
                    {Array.from({ length: colCount }).map((_, c) => (
                      <td key={c} className="max-w-[260px] truncate whitespace-nowrap border-b border-r border-[var(--layer-1)] px-3 py-1 text-[var(--text-primary)]">
                        {r[c] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sheet && sheet.rows.length >= MAX_ROWS && (
            <p className="border-t border-[var(--border-color)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">Showing the first {MAX_ROWS} rows — download for the full sheet.</p>
          )}
        </>
      )}
    </PreviewCard>
  );
}

function colName(i: number) {
  let s = "";
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}
