"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import type { PostMedia } from "@/lib/post-media";
import { HeaderToggle, PreviewCard, PreviewError, PreviewLoading, useProxiedText } from "./PreviewCard";
import { CodeView } from "./CodeView";
import { MermaidBlock } from "./MermaidBlock";

/**
 * Rendered Markdown (GitHub-flavoured: tables, task lists, strikethrough),
 * with highlighted code fences and ```mermaid fences drawn as diagrams.
 * react-markdown never renders raw HTML from the source, so this is safe.
 */
export default function MarkdownPreview({ media, defaultExpanded = true }: { media: PostMedia; defaultExpanded?: boolean }) {
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const { text, error } = useProxiedText(media.url);

  return (
    <PreviewCard
      media={media}
      defaultExpanded={defaultExpanded}
      icon={FileText}
      actions={
        <HeaderToggle
          value={mode}
          onChange={setMode}
          options={[
            { value: "rendered", label: "Rendered" },
            { value: "source", label: "Source" },
          ]}
        />
      }
    >
      {error ? (
        <PreviewError message={error} />
      ) : text === null ? (
        <PreviewLoading />
      ) : mode === "source" ? (
        <CodeView code={text} language="markdown" />
      ) : (
        <article className="md-body max-h-[560px] overflow-auto px-5 py-4">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Fenced code: mermaid → diagram, otherwise highlighted block.
              code({ className, children, ...props }) {
                const match = /language-([\w-]+)/.exec(className || "");
                const code = String(children).replace(/\n$/, "");
                const isBlock = code.includes("\n") || !!match;
                if (!isBlock) {
                  return (
                    <code className="rounded bg-[var(--layer-2)] px-1.5 py-0.5 font-mono text-[0.9em]" {...props}>
                      {children}
                    </code>
                  );
                }
                if (match?.[1] === "mermaid") {
                  return <MermaidBlock code={code} />;
                }
                return (
                  <div className="my-3 overflow-hidden rounded-lg border border-[var(--border-color)]">
                    <CodeView code={code} language={match?.[1]} maxHeight={360} />
                  </div>
                );
              },
              a({ href, children }) {
                return (
                  <a href={href} target="_blank" rel="noreferrer noopener" className="text-[var(--accent)] underline">
                    {children}
                  </a>
                );
              },
              img({ src, alt }) {
                // Only allow http(s)/relative images; no data: URIs from untrusted docs.
                const ok = typeof src === "string" && /^(https?:)?\//.test(src);
                return ok ? <img src={src} alt={alt || ""} className="my-2 max-h-[420px] max-w-full rounded-lg" loading="lazy" /> : null;
              },
              table({ children }) {
                return (
                  <div className="my-3 overflow-x-auto rounded-lg border border-[var(--border-color)]">
                    <table className="w-full border-collapse text-sm">{children}</table>
                  </div>
                );
              },
              th({ children }) {
                return <th className="border-b border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2 text-left font-semibold">{children}</th>;
              },
              td({ children }) {
                return <td className="border-b border-[var(--layer-1)] px-3 py-2 align-top">{children}</td>;
              },
              input({ checked, type }) {
                return type === "checkbox" ? (
                  <input type="checkbox" checked={!!checked} readOnly className="mr-1 align-middle accent-[var(--accent)]" />
                ) : null;
              },
            }}
          >
            {text}
          </Markdown>
          <style jsx global>{`
            .md-body { color: var(--text-primary); font-size: 14.5px; line-height: 1.65; }
            .md-body h1 { font-size: 1.6em; font-weight: 800; margin: 0.8em 0 0.4em; letter-spacing: -0.01em; }
            .md-body h2 { font-size: 1.3em; font-weight: 700; margin: 1em 0 0.4em; }
            .md-body h3 { font-size: 1.1em; font-weight: 700; margin: 0.9em 0 0.3em; }
            .md-body h4, .md-body h5, .md-body h6 { font-weight: 700; margin: 0.8em 0 0.3em; }
            .md-body p { margin: 0.5em 0; }
            .md-body ul, .md-body ol { margin: 0.5em 0; padding-left: 1.4em; }
            .md-body ul { list-style: disc; } .md-body ol { list-style: decimal; }
            .md-body li { margin: 0.2em 0; }
            .md-body li.task-list-item { list-style: none; margin-left: -1.2em; }
            .md-body blockquote { margin: 0.7em 0; padding: 0.2em 1em; border-left: 3px solid var(--accent-ring); color: var(--text-secondary); }
            .md-body hr { border: none; border-top: 1px solid var(--border-color); margin: 1.2em 0; }
            .md-body strong { font-weight: 700; } .md-body em { font-style: italic; }
            .md-body del { text-decoration: line-through; color: var(--text-muted); }
            .md-body > :first-child { margin-top: 0; } .md-body > :last-child { margin-bottom: 0; }
          `}</style>
        </article>
      )}
    </PreviewCard>
  );
}
