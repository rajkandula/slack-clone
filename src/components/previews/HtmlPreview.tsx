"use client";

import { useState } from "react";
import { Globe } from "lucide-react";
import type { PostMedia } from "@/lib/post-media";
import { HeaderToggle, PreviewCard, PreviewError, PreviewLoading, useProxiedText } from "./PreviewCard";
import { CodeView } from "./CodeView";

/**
 * HTML files render inside a fully sandboxed iframe (no scripts, no same-origin
 * access, no forms/popups) via srcdoc — the document is shown as static markup,
 * never executed with our origin. A Source toggle shows the highlighted code.
 */
export default function HtmlPreview({ media, defaultExpanded = true }: { media: PostMedia; defaultExpanded?: boolean }) {
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const { text, error } = useProxiedText(media.url);
  return (
    <PreviewCard
      media={media}
      defaultExpanded={defaultExpanded}
      icon={Globe}
      actions={
        <HeaderToggle value={mode} onChange={setMode} options={[{ value: "rendered", label: "Rendered" }, { value: "source", label: "Source" }]} />
      }
    >
      {error ? (
        <PreviewError message={error} />
      ) : text === null ? (
        <PreviewLoading />
      ) : mode === "source" ? (
        <CodeView code={text} language="xml" />
      ) : (
        <iframe
          title={media.name}
          srcDoc={text}
          sandbox=""
          referrerPolicy="no-referrer"
          className="block h-[480px] w-full bg-white"
        />
      )}
    </PreviewCard>
  );
}
