"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import type { PostMedia } from "@/lib/post-media";
import { PreviewCard, PreviewError, PreviewLoading, useProxiedBytes } from "./PreviewCard";

/** EPUB reader via epub.js — paginated, with previous / next controls. */
export default function EpubPreview({ media, defaultExpanded = true }: { media: PostMedia; defaultExpanded?: boolean }) {
  const { bytes, error } = useProxiedBytes(media.url);
  const hostRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<{ prev: () => void; next: () => void; destroy?: () => void } | null>(null);
  const [ready, setReady] = useState(false);
  const [openError, setOpenError] = useState("");
  const [title, setTitle] = useState<string>("");
  const [location, setLocation] = useState<string>("");

  useEffect(() => {
    if (!bytes || !hostRef.current) return;
    let cancelled = false;
    let book: { destroy?: () => void } | null = null;
    (async () => {
      try {
        const ePub = (await import("epubjs")).default;
        const b = ePub(bytes);
        book = b;
        const rendition = b.renderTo(hostRef.current!, {
          width: "100%",
          height: 520,
          flow: "paginated",
          spread: "none",
          allowScriptedContent: false,
        });
        renditionRef.current = rendition;
        await rendition.display();
        const meta = await b.loaded.metadata;
        if (!cancelled) {
          setTitle(meta?.title || "");
          setReady(true);
        }
        rendition.on("relocated", (loc: { start?: { displayed?: { page?: number; total?: number } } }) => {
          const d = loc?.start?.displayed;
          if (d?.page && d?.total) setLocation(`Page ${d.page} of ${d.total}`);
        });
      } catch (err) {
        if (!cancelled) setOpenError(err instanceof Error ? err.message : "Could not open book");
      }
    })();
    return () => {
      cancelled = true;
      try { renditionRef.current?.destroy?.(); } catch { /* noop */ }
      try { book?.destroy?.(); } catch { /* noop */ }
      renditionRef.current = null;
    };
  }, [bytes]);

  return (
    <PreviewCard
 media={media}
 defaultExpanded={defaultExpanded} icon={BookOpen} meta={title ? <>{title}{location ? ` · ${location}` : ""}</> : undefined}>
      {error || openError ? (
        <PreviewError message={error || openError} />
      ) : (
        <div className="relative">
          {!ready && <PreviewLoading />}
          <div ref={hostRef} className={`epub-host bg-white ${ready ? "" : "h-0 overflow-hidden"}`} />
          {ready && (
            <div className="flex items-center justify-between border-t border-[var(--border-color)] px-2 py-1.5">
              <button type="button" onClick={() => renditionRef.current?.prev()} className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]">
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <span className="text-[11px] text-[var(--text-muted)]">{location}</span>
              <button type="button" onClick={() => renditionRef.current?.next()} className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </PreviewCard>
  );
}
