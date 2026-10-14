"use client";

import { Table2 } from "lucide-react";
import { extensionOf, type PostMedia } from "@/lib/post-media";
import { PreviewCard, PreviewError, PreviewLoading, useProxiedText } from "./PreviewCard";

const MAX_ROWS = 200;

/** CSV / TSV rendered as a grid. Tiny RFC-4180-ish parser, no library needed. */
function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export default function TablePreview({ media, defaultExpanded = true }: { media: PostMedia; defaultExpanded?: boolean }) {
  const { text, error } = useProxiedText(media.url);
  const delim = extensionOf(media.name) === "tsv" ? "\t" : ",";
  const rows = text !== null ? parseDelimited(text, delim) : null;
  const shown = rows?.slice(0, MAX_ROWS + 1);

  return (
    <PreviewCard
 media={media}
 defaultExpanded={defaultExpanded} icon={Table2}>
      {error ? (
        <PreviewError message={error} />
      ) : !shown ? (
        <PreviewLoading />
      ) : (
        <>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full border-collapse text-xs">
              <tbody>
                {shown.map((r, ri) => (
                  <tr key={ri} className={ri === 0 ? "sticky top-0 bg-[var(--bg-surface)] font-semibold" : "odd:bg-[var(--layer-1)]"}>
                    {r.map((c, ci) => (
                      <td key={ci} className="max-w-[280px] truncate whitespace-nowrap border-b border-r border-[var(--layer-1)] px-3 py-1.5 text-[var(--text-primary)]">{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows && rows.length > MAX_ROWS + 1 && (
            <p className="border-t border-[var(--border-color)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">Showing the first {MAX_ROWS} rows — download for everything.</p>
          )}
        </>
      )}
    </PreviewCard>
  );
}
