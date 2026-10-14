"use client";

import { useState } from "react";
import { Shapes } from "lucide-react";
import type { PostMedia } from "@/lib/post-media";
import { HeaderToggle, PreviewCard, PreviewError, PreviewLoading, useProxiedText } from "./PreviewCard";
import { CodeView } from "./CodeView";

/** SVG shown as an image (scripts cannot run inside <img>) with a Source toggle. */
export default function SvgPreview({ media, defaultExpanded = true }: { media: PostMedia; defaultExpanded?: boolean }) {
  const [mode, setMode] = useState<"image" | "source">("image");
  const { text, error } = useProxiedText(media.url);
  return (
    <PreviewCard
      media={media}
      defaultExpanded={defaultExpanded}
      icon={Shapes}
      primaryAction="open"
      actions={
        <HeaderToggle value={mode} onChange={setMode} options={[{ value: "image", label: "Image" }, { value: "source", label: "Source" }]} />
      }
    >
      {mode === "image" ? (
        <div className="svg-checker flex justify-center p-4">
          <img src={media.url} alt={media.name} className="max-h-[420px] max-w-full" />
          <style jsx>{`
            .svg-checker {
              background-color: var(--bg-app);
              background-image:
                linear-gradient(45deg, var(--layer-2) 25%, transparent 25%),
                linear-gradient(-45deg, var(--layer-2) 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, var(--layer-2) 75%),
                linear-gradient(-45deg, transparent 75%, var(--layer-2) 75%);
              background-size: 16px 16px;
              background-position: 0 0, 0 8px, 8px -8px, -8px 0;
            }
          `}</style>
        </div>
      ) : error ? (
        <PreviewError message={error} />
      ) : text === null ? (
        <PreviewLoading />
      ) : (
        <CodeView code={text} language="xml" />
      )}
    </PreviewCard>
  );
}
