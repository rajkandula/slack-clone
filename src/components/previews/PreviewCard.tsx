"use client";

import { ReactNode, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Download, ExternalLink, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PostMedia, describeFormat, formatBytes } from "@/lib/post-media";

/* =========================================================================
   Shared chrome for every in-app file preview
   -------------------------------------------------------------------------
   One consistent card: icon · name · format/size · [extra actions] ·
   collapse · open/download. Renderers only provide the body.
   ========================================================================= */

interface PreviewCardProps {
  media: PostMedia;
  icon: LucideIcon;
  /** Extra header controls (e.g. a Source/Rendered toggle). */
  actions?: ReactNode;
  /** Subtitle override (defaults to "Format · size"). */
  meta?: ReactNode;
  /** Body is only mounted while expanded, so heavy renderers stay lazy. */
  children: ReactNode;
  defaultExpanded?: boolean;
  /** "open" shows an open-in-new-tab icon (pdf/image), "download" a download icon. */
  primaryAction?: "open" | "download";
  bodyClassName?: string;
}

export function PreviewCard({
  media,
  icon: Icon,
  actions,
  meta,
  children,
  defaultExpanded = true,
  primaryAction = "download",
  bodyClassName = "",
}: PreviewCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)]">
      <div className="flex items-center gap-3 px-3 py-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-muted)] text-[var(--accent)]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{media.name}</p>
          <p className="truncate text-xs text-[var(--text-muted)]">
            {meta ?? (
              <>
                {describeFormat(media)}
                {media.size ? ` · ${formatBytes(media.size)}` : ""}
              </>
            )}
          </p>
        </div>
        {actions}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse preview" : "Expand preview"}
          title={expanded ? "Collapse preview" : "Expand preview"}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <a
          href={media.url}
          target="_blank"
          rel="noreferrer"
          download={primaryAction === "download" ? media.name : undefined}
          title={primaryAction === "open" ? "Open in new tab" : "Download"}
          aria-label={primaryAction === "open" ? "Open in new tab" : "Download file"}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
        >
          {primaryAction === "open" ? <ExternalLink className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        </a>
      </div>

      {expanded && (
        <div className={`border-t border-[var(--border-color)] bg-[var(--bg-app)] ${bodyClassName}`}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Small pill toggle used for Rendered/Source style switches in the header. */
export function HeaderToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="mr-1 inline-flex items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={[
            "cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold transition-colors",
            value === o.value
              ? "bg-[var(--accent-muted)] text-[var(--accent)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PreviewLoading() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
    </div>
  );
}

export function PreviewError({ message }: { message: string }) {
  return <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">{message}</p>;
}

/* ---- Data hooks -------------------------------------------------------- */

export function proxyUrl(url: string) {
  return `/api/media/proxy?url=${encodeURIComponent(url)}`;
}

/** Fetch an uploaded file as text through the same-origin proxy. */
export function useProxiedText(url: string) {
  const [state, setState] = useState<{ url: string; text: string | null; error: string }>({ url, text: null, error: "" });
  const text = state.url === url ? state.text : null;
  const error = state.url === url ? state.error : "";
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(proxyUrl(url));
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Preview unavailable");
        const body = await res.text();
        if (!cancelled) setState({ url, text: body, error: "" });
      } catch (err) {
        if (!cancelled) setState({ url, text: null, error: err instanceof Error ? err.message : "Preview unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);
  return { text, error };
}

/** Fetch an uploaded file as bytes through the same-origin proxy. */
export function useProxiedBytes(url: string) {
  const [state, setState] = useState<{ url: string; bytes: ArrayBuffer | null; error: string }>({ url, bytes: null, error: "" });
  const bytes = state.url === url ? state.bytes : null;
  const error = state.url === url ? state.error : "";
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(proxyUrl(url));
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Preview unavailable");
        const buf = await res.arrayBuffer();
        if (!cancelled) setState({ url, bytes: buf, error: "" });
      } catch (err) {
        if (!cancelled) setState({ url, bytes: null, error: err instanceof Error ? err.message : "Preview unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);
  return { bytes, error };
}
