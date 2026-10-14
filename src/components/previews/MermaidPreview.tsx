"use client";

import { useState } from "react";
import { GitBranch } from "lucide-react";
import type { PostMedia } from "@/lib/post-media";
import { HeaderToggle, PreviewCard, PreviewError, PreviewLoading, useProxiedText } from "./PreviewCard";
import { CodeView } from "./CodeView";
import { MermaidBlock } from "./MermaidBlock";

/** A standalone .mmd / .mermaid file rendered as a diagram, with a source toggle. */
export default function MermaidPreview({ media, defaultExpanded = true }: { media: PostMedia; defaultExpanded?: boolean }) {
  const [mode, setMode] = useState<"diagram" | "source">("diagram");
  const { text, error } = useProxiedText(media.url);
  return (
    <PreviewCard
      media={media}
      defaultExpanded={defaultExpanded}
      icon={GitBranch}
      actions={
        <HeaderToggle value={mode} onChange={setMode} options={[{ value: "diagram", label: "Diagram" }, { value: "source", label: "Source" }]} />
      }
    >
      {error ? <PreviewError message={error} /> : text === null ? <PreviewLoading /> : mode === "source" ? <CodeView code={text} /> : <MermaidBlock code={text} />}
    </PreviewCard>
  );
}
