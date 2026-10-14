"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import type { PostMedia } from "@/lib/post-media";
import { PreviewCard, PreviewError, PreviewLoading, useProxiedBytes } from "./PreviewCard";

const DOC_CSS = `
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px 28px; font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1d21; background: #fff; }
  h1,h2,h3,h4 { line-height: 1.25; margin: 1.2em 0 0.5em; } h1{font-size:1.7em} h2{font-size:1.35em} h3{font-size:1.15em}
  p { margin: 0.55em 0; } img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; margin: 0.8em 0; } td, th { border: 1px solid #d0d4da; padding: 4px 8px; }
  ul, ol { padding-left: 1.5em; } a { color: #2563eb; }
`;

/**
 * Word (.docx) rendered to HTML with mammoth, displayed inside a sandboxed
 * iframe (no scripts, no same-origin) so the document can never touch the app.
 */
export default function DocxPreview({ media, defaultExpanded = true }: { media: PostMedia; defaultExpanded?: boolean }) {
  const { bytes, error } = useProxiedBytes(media.url);
  const [html, setHtml] = useState<string | null>(null);
  const [convError, setConvError] = useState("");

  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    (async () => {
      try {
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
        if (!cancelled) setHtml(result.value);
      } catch (err) {
        if (!cancelled) setConvError(err instanceof Error ? err.message : "Could not read document");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  return (
    <PreviewCard
 media={media}
 defaultExpanded={defaultExpanded} icon={FileText}>
      {error || convError ? (
        <PreviewError message={error || convError} />
      ) : html === null ? (
        <PreviewLoading />
      ) : (
        <iframe
          title={media.name}
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>${DOC_CSS}</style></head><body>${html}</body></html>`}
          sandbox=""
          referrerPolicy="no-referrer"
          className="block h-[560px] w-full bg-white"
        />
      )}
    </PreviewCard>
  );
}
