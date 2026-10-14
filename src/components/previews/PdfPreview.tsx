"use client";

import { FileText } from "lucide-react";
import type { PostMedia } from "@/lib/post-media";
import { PreviewCard } from "./PreviewCard";

/** Native browser PDF viewer, with a clean fallback where inline PDFs aren't supported. */
export default function PdfPreview({ media, defaultExpanded = true }: { media: PostMedia; defaultExpanded?: boolean }) {
  const src = `${media.url}#toolbar=0&navpanes=0&view=FitH`;
  return (
    <PreviewCard
 media={media}
 defaultExpanded={defaultExpanded} icon={FileText} primaryAction="open">
      <object data={src} type="application/pdf" aria-label={media.name} className="block h-[480px] w-full bg-white">
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-[var(--bg-surface)] px-4 text-center">
          <FileText className="h-8 w-8 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-secondary)]">Inline preview isn&apos;t available in this browser.</p>
          <a href={media.url} target="_blank" rel="noreferrer" className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]">Open PDF</a>
        </div>
      </object>
    </PreviewCard>
  );
}
