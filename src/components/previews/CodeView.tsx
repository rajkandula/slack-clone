"use client";

import { useEffect, useMemo, useState } from "react";
import { CODE_LANGS, extensionOf } from "@/lib/post-media";

/**
 * Syntax-highlighted code block. highlight.js is imported lazily (and only
 * the "common" language pack) so it never lands in the main bundle. Output
 * is rendered via hljs's own escaped HTML — it never emits raw input.
 */
export function CodeView({
  code,
  filename,
  language,
  maxHeight = 420,
}: {
  code: string;
  filename?: string;
  language?: string;
  maxHeight?: number;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const lang = useMemo(
    () => language || CODE_LANGS[extensionOf(filename || "")] || undefined,
    [language, filename]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hljs = (await import("highlight.js/lib/common")).default;
        const result =
          lang && hljs.getLanguage(lang)
            ? hljs.highlight(code, { language: lang, ignoreIllegals: true })
            : hljs.highlightAuto(code);
        if (!cancelled) setHtml(result.value);
      } catch {
        if (!cancelled) setHtml(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  const lines = code.split("\n").length;

  return (
    <div className="code-view overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse font-mono text-[12.5px] leading-[1.55]">
        <tbody>
          {(html ?? escapeHtml(code)).split("\n").map((line, i) => (
            <tr key={i}>
              <td
                aria-hidden
                className="select-none border-r border-[var(--border-color)] bg-[var(--bg-surface)] px-3 text-right align-top text-[var(--text-muted)]"
                style={{ width: `${String(lines).length + 2}ch` }}
              >
                {i + 1}
              </td>
              <td
                className="whitespace-pre px-3 align-top text-[var(--text-primary)]"
                // hljs output is escaped HTML with span wrappers only.
                dangerouslySetInnerHTML={{ __html: line || " " }}
              />
            </tr>
          ))}
        </tbody>
      </table>
      <style jsx global>{`
        .code-view .hljs-keyword, .code-view .hljs-selector-tag, .code-view .hljs-built_in, .code-view .hljs-name, .code-view .hljs-tag { color: #7c3aed; }
        .code-view .hljs-string, .code-view .hljs-attr, .code-view .hljs-addition, .code-view .hljs-template-tag { color: #15803d; }
        .code-view .hljs-number, .code-view .hljs-literal, .code-view .hljs-symbol, .code-view .hljs-bullet { color: #b45309; }
        .code-view .hljs-comment, .code-view .hljs-quote, .code-view .hljs-meta { color: var(--text-muted); font-style: italic; }
        .code-view .hljs-title, .code-view .hljs-section, .code-view .hljs-function .hljs-title, .code-view .hljs-title.function_ { color: #1d4ed8; }
        .code-view .hljs-attribute, .code-view .hljs-variable, .code-view .hljs-type, .code-view .hljs-class .hljs-title, .code-view .hljs-title.class_ { color: #0e7490; }
        .code-view .hljs-deletion { color: #b91c1c; }
        .code-view .hljs-emphasis { font-style: italic; }
        .code-view .hljs-strong { font-weight: 700; }
        :root[data-theme="dark"] .code-view .hljs-keyword, :root[data-theme="dark"] .code-view .hljs-selector-tag, :root[data-theme="dark"] .code-view .hljs-built_in, :root[data-theme="dark"] .code-view .hljs-name, :root[data-theme="dark"] .code-view .hljs-tag { color: #c4b5fd; }
        :root[data-theme="dark"] .code-view .hljs-string, :root[data-theme="dark"] .code-view .hljs-attr, :root[data-theme="dark"] .code-view .hljs-addition { color: #86efac; }
        :root[data-theme="dark"] .code-view .hljs-number, :root[data-theme="dark"] .code-view .hljs-literal, :root[data-theme="dark"] .code-view .hljs-symbol { color: #fcd34d; }
        :root[data-theme="dark"] .code-view .hljs-title, :root[data-theme="dark"] .code-view .hljs-section, :root[data-theme="dark"] .code-view .hljs-title.function_ { color: #93c5fd; }
        :root[data-theme="dark"] .code-view .hljs-attribute, :root[data-theme="dark"] .code-view .hljs-variable, :root[data-theme="dark"] .code-view .hljs-type, :root[data-theme="dark"] .code-view .hljs-title.class_ { color: #67e8f9; }
      `}</style>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
