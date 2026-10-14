"use client";

import { FileCode2 } from "lucide-react";
import type { PostMedia } from "@/lib/post-media";
import { PreviewCard, PreviewError, PreviewLoading, useProxiedText } from "./PreviewCard";
import { CodeView } from "./CodeView";

/** Any source / config / log / plain-text file, syntax highlighted with line numbers. */
export default function CodePreview({ media, defaultExpanded = true }: { media: PostMedia; defaultExpanded?: boolean }) {
  const { text, error } = useProxiedText(media.url);
  return (
    <PreviewCard
 media={media}
 defaultExpanded={defaultExpanded} icon={FileCode2}>
      {error ? <PreviewError message={error} /> : text === null ? <PreviewLoading /> : <CodeView code={text} filename={media.name} />}
    </PreviewCard>
  );
}
