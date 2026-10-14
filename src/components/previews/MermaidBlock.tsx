"use client";

import { useEffect, useId, useState } from "react";
import { useTheme } from "../ThemeProvider";

let mermaidReady: Promise<typeof import("mermaid")["default"]> | null = null;

async function loadMermaid(dark: boolean) {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((m) => m.default);
  }
  const mermaid = await mermaidReady;
  mermaid.initialize({
    startOnLoad: false,
    // "strict" sanitises labels and disables click handlers / scripts.
    securityLevel: "strict",
    theme: dark ? "dark" : "neutral",
    fontFamily: "inherit",
  });
  return mermaid;
}

/** Renders a mermaid definition to inline SVG. Safe: securityLevel strict. */
export function MermaidBlock({ code }: { code: string }) {
  const { resolvedTheme } = useTheme();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [state, setState] = useState<{ key: string; svg: string | null; error: string }>({ key: "", svg: null, error: "" });
  const key = `${resolvedTheme}:${code}`;
  const svg = state.key === key ? state.svg : null;
  const error = state.key === key ? state.error : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = await loadMermaid(resolvedTheme === "dark");
        const { svg } = await mermaid.render(`mmd-${id}`, code.trim());
        if (!cancelled) setState({ key, svg, error: "" });
      } catch (err) {
        if (!cancelled) setState({ key, svg: null, error: err instanceof Error ? err.message : "Could not render diagram" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id, resolvedTheme, key]);

  if (error) {
    return (
      <pre className="whitespace-pre-wrap px-4 py-3 font-mono text-xs text-[var(--danger)]">
        Diagram error: {error}
      </pre>
    );
  }
  if (!svg) {
    return <p className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">Rendering diagram…</p>;
  }
  return (
    <div
      className="mermaid-block flex justify-center overflow-auto px-4 py-4 [&_svg]:h-auto [&_svg]:max-w-full"
      // mermaid's output is its own generated SVG (strict mode escapes labels).
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
