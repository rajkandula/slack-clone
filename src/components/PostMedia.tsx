"use client";

import { useRef, useState, type ComponentType } from "react";
import dynamic from "next/dynamic";
import {
  Eye,
  EyeOff,
  FileText,
  File as FileIcon,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  Paperclip,
  X,
} from "lucide-react";
import {
  ACCEPT,
  MAX_ATTACHMENT_BYTES,
  MAX_POST_ATTACHMENTS,
  PostMedia,
  PostMediaType,
  classifyFile,
  describeFormat,
  formatBytes,
  isPdf,
  previewKind,
} from "@/lib/post-media";

/* =========================================================================
   Rendering attachments on a post
   ========================================================================= */

export function PostAttachments({ media }: { media?: PostMedia[] | null }) {
  if (!media || media.length === 0) return null;

  // Raster images are grouped into a grid; everything else renders in order,
  // each with the renderer that fits its format (see previewKind).
  const images = media.filter((m) => previewKind(m) === "image");
  const others = media.filter((m) => previewKind(m) !== "image");

  // With several attachments, document previews start collapsed so the post
  // stays scannable (and no bytes are fetched until a preview is opened).
  const compact = media.length > 1;

  const sensitiveImages = images.some((m) => m.sensitive);

  return (
    <div className="mt-2 flex flex-col gap-2">
      {images.length > 0 &&
        (sensitiveImages ? (
          <SensitiveGate><ImageGrid images={images} /></SensitiveGate>
        ) : (
          <ImageGrid images={images} />
        ))}
      {others.map((m, i) => (
        <AttachmentRenderer key={m.url + i} media={m} compact={compact} />
      ))}
    </div>
  );
}

function ImageGrid({ images }: { images: PostMedia[] }) {
  return (
    <div
      className={[
        "grid gap-1 overflow-hidden rounded-2xl border border-[var(--border-color)]",
        images.length === 1 ? "grid-cols-1" : "grid-cols-2",
      ].join(" ")}
    >
      {images.map((m, i) => (
        <a
          key={m.url + i}
          href={m.originalUrl || m.url}
          target="_blank"
          rel="noreferrer"
          title={m.originalUrl ? "Open full-quality original" : m.name}
          className={["block bg-[var(--bg-surface)]", images.length === 3 && i === 0 ? "row-span-2" : ""].join(" ")}
        >
          <img
            src={m.url}
            alt={m.name}
            loading="lazy"
            width={m.width}
            height={m.height}
            className={[
              "h-full w-full object-cover",
              images.length === 1 ? "max-h-[520px]" : "aspect-square max-h-[260px]",
            ].join(" ")}
          />
        </a>
      ))}
    </div>
  );
}

/**
 * Click-to-reveal cover for media the upload scanner flagged as sensitive.
 * The media is mounted underneath but heavily blurred until the viewer opts in.
 */
export function SensitiveGate({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div className={revealed ? "" : "pointer-events-none select-none blur-2xl saturate-50"} aria-hidden={!revealed}>
        {children}
      </div>
      {revealed ? (
        <button
          type="button"
          onClick={() => setRevealed(false)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          title="Hide again"
          className="absolute left-2 top-2 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
        >
          {hovered ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 bg-black/30 text-white"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50"><EyeOff className="h-5 w-5" /></span>
          <span className="text-sm font-semibold drop-shadow">Sensitive content</span>
          <span className="text-xs opacity-90 drop-shadow">This may contain nudity or suggestive material. Click to view.</span>
        </button>
      )}
    </div>
  );
}

/* Lazily-loaded renderers — none of these libraries ship in the main bundle. */
const lazy = <P extends object>(loader: () => Promise<{ default: ComponentType<P> }>) =>
  dynamic(loader, { ssr: false, loading: () => <RendererSkeleton /> });

const PdfPreview = lazy<{ media: PostMedia; defaultExpanded?: boolean }>(() => import("./previews/PdfPreview"));
const MarkdownPreview = lazy<{ media: PostMedia; defaultExpanded?: boolean }>(() => import("./previews/MarkdownPreview"));
const MermaidPreview = lazy<{ media: PostMedia; defaultExpanded?: boolean }>(() => import("./previews/MermaidPreview"));
const HtmlPreview = lazy<{ media: PostMedia; defaultExpanded?: boolean }>(() => import("./previews/HtmlPreview"));
const SvgPreview = lazy<{ media: PostMedia; defaultExpanded?: boolean }>(() => import("./previews/SvgPreview"));
const CodePreview = lazy<{ media: PostMedia; defaultExpanded?: boolean }>(() => import("./previews/CodePreview"));
const TablePreview = lazy<{ media: PostMedia; defaultExpanded?: boolean }>(() => import("./previews/TablePreview"));
const SheetPreview = lazy<{ media: PostMedia; defaultExpanded?: boolean }>(() => import("./previews/SheetPreview"));
const DocxPreview = lazy<{ media: PostMedia; defaultExpanded?: boolean }>(() => import("./previews/DocxPreview"));
const EpubPreview = lazy<{ media: PostMedia; defaultExpanded?: boolean }>(() => import("./previews/EpubPreview"));

function RendererSkeleton() {
  return <div className="h-14 animate-pulse rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)]" />;
}

export function AttachmentRenderer({ media: m, compact = false }: { media: PostMedia; compact?: boolean }) {
  const expand = !compact;
  switch (previewKind(m)) {
    case "video": {
      const video = (
        <video
          src={m.url}
          poster={m.thumbUrl}
          controls
          preload="metadata"
          className="max-h-[480px] w-full rounded-2xl border border-[var(--border-color)] bg-black"
        />
      );
      return m.sensitive ? <SensitiveGate>{video}</SensitiveGate> : video;
    }
    case "audio":
      return (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-muted)] text-[var(--accent)]">
            <Music className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-[var(--text-primary)]">{m.name}</p>
            <audio src={m.url} controls preload="metadata" className="mt-1 h-8 w-full" />
          </div>
        </div>
      );
    case "pdf": return <PdfPreview media={m} defaultExpanded={expand} />;
    case "markdown": return <MarkdownPreview media={m} defaultExpanded={expand} />;
    case "mermaid": return <MermaidPreview media={m} defaultExpanded={expand} />;
    case "html": return <HtmlPreview media={m} defaultExpanded={expand} />;
    case "svg": return <SvgPreview media={m} defaultExpanded={expand} />;
    case "code": return <CodePreview media={m} defaultExpanded={expand} />;
    case "table": return <TablePreview media={m} defaultExpanded={expand} />;
    case "sheet": return <SheetPreview media={m} defaultExpanded={expand} />;
    case "docx": return <DocxPreview media={m} defaultExpanded={expand} />;
    case "epub": return <EpubPreview media={m} defaultExpanded={expand} />;
    case "image":
      return <ImageGrid images={[m]} />;
    default:
      // No in-browser renderer (pptx, archives, …): a clean download chip.
      return (
        <a
          href={m.url}
          target="_blank"
          rel="noreferrer"
          download={m.name}
          className="flex items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 transition-colors hover:bg-[var(--bg-surface-hover)]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-muted)] text-[var(--accent)]">
            <FileIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">{m.name}</span>
            <span className="block text-xs text-[var(--text-muted)]">
              {describeFormat(m)}{m.size ? ` · ${formatBytes(m.size)}` : ""} · Download
            </span>
          </span>
        </a>
      );
  }
}

/* =========================================================================
   Composer: pick, upload, preview, remove
   ========================================================================= */

export interface PendingAttachment extends PostMedia {
  /** local id for React keys and removal */
  localId: string;
  uploading?: boolean;
}

interface AttachmentPickerProps {
  attachments: PendingAttachment[];
  onChange: (next: PendingAttachment[]) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}

const BUTTONS: Array<{ type: PostMediaType; label: string; Icon: typeof ImageIcon }> = [
  { type: "image", label: "Add photos", Icon: ImageIcon },
  { type: "video", label: "Add a video", Icon: Film },
  { type: "audio", label: "Add audio", Icon: Music },
  { type: "file", label: "Attach a file (PDF, docs…)", Icon: Paperclip },
];

/** Toolbar buttons (image / video / audio / file) — renders inline. */
export function AttachmentButtons({ attachments, onChange, onError, disabled }: AttachmentPickerProps) {
  const inputRefs = useRef<Record<PostMediaType, HTMLInputElement | null>>({
    image: null,
    video: null,
    audio: null,
    file: null,
  });
  const [busy, setBusy] = useState(false);

  const remaining = MAX_POST_ATTACHMENTS - attachments.length;

  const handleFiles = async (type: PostMediaType, list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = Array.from(list).slice(0, Math.max(0, remaining));
    if (files.length < list.length) {
      onError?.(`You can attach up to ${MAX_POST_ATTACHMENTS} files per post`);
    }
    const tooBig = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig.length) {
      onError?.(`${tooBig[0].name} is larger than 25 MB`);
    }
    const ok = files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    if (ok.length === 0) return;

    // Optimistic placeholders so the user sees progress immediately.
    const placeholders: PendingAttachment[] = ok.map((f) => ({
      localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url: ["image", "video"].includes(classifyFile(f.name, f.type)) ? URL.createObjectURL(f) : "",
      type: classifyFile(f.name, f.type),
      name: f.name,
      size: f.size,
      mime: f.type || "application/octet-stream",
      uploading: true,
    }));
    let current = [...attachments, ...placeholders];
    onChange(current);
    setBusy(true);

    for (let i = 0; i < ok.length; i++) {
      const file = ok[i];
      const ph = placeholders[i];
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/media/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");
        current = current.map((a) =>
          a.localId === ph.localId
            ? {
                ...a,
                url: data.mediaUrl,
                uploading: false,
                mime: data.mime || a.mime,
                type: data.type || a.type,
                originalUrl: data.originalUrl,
                thumbUrl: data.thumbUrl,
                width: data.width,
                height: data.height,
                size: data.size ?? a.size,
              }
            : a
        );
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Upload failed");
        current = current.filter((a) => a.localId !== ph.localId);
      }
      onChange(current);
    }
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-1">
      {BUTTONS.map(({ type, label, Icon }) => (
        <span key={type}>
          <input
            ref={(el) => {
              inputRefs.current[type] = el;
            }}
            type="file"
            accept={ACCEPT[type]}
            multiple={type === "image" || type === "file"}
            className="hidden"
            onChange={(e) => {
              handleFiles(type, e.target.files);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
          <button
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled || busy || remaining <= 0}
            onClick={() => inputRefs.current[type]?.click()}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--accent)] transition-colors hover:bg-[var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon className="h-4 w-4" />
          </button>
        </span>
      ))}
      {busy && <Loader2 className="ml-1 h-4 w-4 animate-spin text-[var(--text-muted)]" />}
    </div>
  );
}

/** Preview strip shown above the toolbar while composing. */
export function AttachmentPreviews({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onRemove: (localId: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((a) => (
        <div
          key={a.localId}
          className="relative flex max-w-full items-center gap-2 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)]"
        >
          {a.type === "image" && a.url ? (
            <img src={a.url} alt="" className="h-20 w-20 object-cover" />
          ) : a.type === "video" && a.url ? (
            <video src={a.url} className="h-20 w-28 bg-black object-cover" muted />
          ) : (
            <div className="flex items-center gap-2 py-2 pl-2 pr-8">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-muted)] text-[var(--accent)]">
                {a.type === "audio" ? (
                  <Music className="h-4 w-4" />
                ) : isPdf(a) ? (
                  <FileText className="h-4 w-4" />
                ) : (
                  <FileIcon className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block max-w-[160px] truncate text-xs font-semibold text-[var(--text-primary)]">
                  {a.name}
                </span>
                <span className="block text-[11px] text-[var(--text-muted)]">
                  {describeFormat(a)} · {formatBytes(a.size)}
                </span>
              </span>
            </div>
          )}

          {a.uploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-[var(--layer-scrim)]">
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            </span>
          )}

          <button
            type="button"
            onClick={() => onRemove(a.localId)}
            aria-label={`Remove ${a.name}`}
            className="absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
