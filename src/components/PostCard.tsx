"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Check,
  Globe,
  Heart,
  Lock,
  MessageCircle,
  MessageCircleOff,
  MoreHorizontal,
  Pencil,
  Flag,
  Repeat,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { handleAvatarError, prettyAvatar } from "@/lib/avatar";
import type { PostMedia } from "@/lib/post-media";
import { AttachmentPreviews, PendingAttachment, PostAttachments } from "./PostMedia";
import PostComments from "./PostComments";
import { navigate } from "@/lib/navigate";

/* =========================================================================
   Post model + visibility
   ========================================================================= */

export type PostVisibility = "public" | "followers" | "private";

export const VISIBILITY_OPTIONS: Array<{
  value: PostVisibility;
  label: string;
  hint: string;
  Icon: typeof Globe;
}> = [
  { value: "public", label: "Public", hint: "Anyone on WASP can see this", Icon: Globe },
  { value: "followers", label: "Followers", hint: "Only people who follow you", Icon: Users },
  { value: "private", label: "Only me", hint: "Hidden from everyone but you", Icon: Lock },
];

export function visibilityMeta(v: PostVisibility | undefined) {
  return VISIBILITY_OPTIONS.find((o) => o.value === v) ?? VISIBILITY_OPTIONS[0];
}

export interface FeedPost {
  id: string;
  authorId: string;
  author: { username: string; displayName: string; avatarUrl: string };
  text: string;
  mediaUrl?: string | null;
  media?: PostMedia[];
  visibility?: PostVisibility;
  repostedBy?: { username: string; displayName: string } | null;
  commentsEnabled?: boolean;
  editedAt?: string | null;
  isOwner?: boolean;
  likes: number;
  reposts: number;
  replies: number;
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
  createdAt: string;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtNum(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

/* =========================================================================
   Visibility picker (used in the composer and the edit menu)
   ========================================================================= */

export function VisibilityPicker({
  value,
  onChange,
  compact = false,
}: {
  value: PostVisibility;
  onChange: (v: PostVisibility) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = visibilityMeta(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Who can see this: ${current.label}`}
        className="flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-ring)] hover:text-[var(--accent)]"
      >
        <current.Icon className="h-3.5 w-3.5" />
        {!compact && <span>{current.label}</span>}
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-30 mb-2 w-64 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-lg)]"
        >
          {VISIBILITY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-muted)] text-[var(--accent)]">
                <o.Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--text-primary)]">{o.label}</span>
                <span className="block text-xs text-[var(--text-muted)]">{o.hint}</span>
              </span>
              {o.value === value && <Check className="mt-1 h-4 w-4 text-[var(--accent)]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   Post card
   ========================================================================= */

interface PostCardProps {
  post: FeedPost;
  currentUser: { username: string; avatarUrl: string };
  onToggle: (id: string, action: "like" | "repost" | "bookmark") => void;
  onUpdated: (post: FeedPost) => void;
  onDeleted: (id: string) => void;
}

export function PostCard({ post, currentUser, onToggle, onUpdated, onDeleted }: PostCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(post.text);
  const [draftMedia, setDraftMedia] = useState<PendingAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportState, setReportState] = useState<"idle" | "sent">("idle");
  const menuRef = useRef<HTMLDivElement>(null);

  const REPORT_REASONS = [
    { value: "sexual", label: "Nudity or sexual content" },
    { value: "harassment", label: "Harassment or hate" },
    { value: "spam", label: "Spam or misleading" },
    { value: "violence", label: "Violence" },
    { value: "other", label: "Something else" },
  ] as const;

  const reportPost = async (reason: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "post", targetId: post.id, reason }),
      });
      if (res.ok) setReportState("sent");
    } finally {
      setBusy(false);
    }
  };

  const vis = visibilityMeta(post.visibility);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const startEdit = () => {
    setDraftText(post.text);
    setDraftMedia(
      (post.media ?? []).map((m, i) => ({ ...m, localId: `${post.id}-${i}` }))
    );
    setError("");
    setEditing(true);
    setMenuOpen(false);
  };

  const saveEdit = async () => {
    if (busy) return;
    const text = draftText.trim();
    if (!text && draftMedia.length === 0) {
      setError("A post needs text or an attachment");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const media: PostMedia[] = draftMedia.map(({ url, type, name, size, mime, originalUrl, thumbUrl, width, height }) => ({
        url, type, name, size, mime, originalUrl, thumbUrl, width, height,
      }));
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, media }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      onUpdated({ ...post, text: data.text, media: data.media, editedAt: data.editedAt });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const changeVisibility = async (visibility: PostVisibility) => {
    if (busy || visibility === post.visibility) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update");
      onUpdated({ ...post, visibility: data.visibility });
      setMenuOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update");
    } finally {
      setBusy(false);
    }
  };

  const toggleComments = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = !(post.commentsEnabled !== false);
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentsEnabled: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update");
      onUpdated({ ...post, commentsEnabled: data.commentsEnabled });
      setMenuOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update");
    } finally {
      setBusy(false);
    }
  };

  const deletePost = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not delete");
      onDeleted(post.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
      setBusy(false);
    }
  };

  return (
    <article className="border-b border-[var(--layer-1)] px-5 py-4 transition-colors hover:bg-[var(--layer-1)]">
      {post.repostedBy && (
        <p className="mb-1.5 flex items-center gap-1.5 pl-[52px] text-xs font-semibold text-[var(--text-muted)]">
          <Repeat className="h-3.5 w-3.5" /> {post.repostedBy.displayName} reposted
        </p>
      )}
      <div className="flex gap-3">
      <img
        src={prettyAvatar(post.author.avatarUrl, post.author.username)}
        onError={(e) => handleAvatarError(e, post.author.username)}
        alt=""
        role="link"
        title={`@${post.author.username}`}
        onClick={() => navigate(`/u/${post.author.username}`)}
        className="h-10 w-10 shrink-0 cursor-pointer rounded-full object-cover"
      />

      <div className="min-w-0 flex-1">
        {/* ---- header ---- */}
        <div className="flex items-center gap-1.5 text-[13.5px]">
          <button type="button" onClick={() => navigate(`/u/${post.author.username}`)} className="cursor-pointer truncate bg-transparent p-0 font-bold text-[var(--text-primary)] hover:underline">{post.author.displayName}</button>
          <span className="truncate text-[var(--text-muted)]">@{post.author.username}</span>
          <span className="text-[var(--text-muted)]">·</span>
          <span className="shrink-0 text-[var(--text-muted)]">{timeAgo(post.createdAt)}</span>
          {post.editedAt && <span className="shrink-0 text-[var(--text-muted)]">· edited</span>}
          {post.visibility && post.visibility !== "public" && (
            <span
              title={vis.hint}
              className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--text-secondary)]"
            >
              <vis.Icon className="h-3 w-3" /> {vis.label}
            </span>
          )}

          {/* ---- non-owner: report ---- */}
          {!post.isOwner && (
            <div ref={menuRef} className="relative ml-auto">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Post options"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-muted)] hover:text-[var(--accent)]"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-lg)]">
                  {reportState === "sent" ? (
                    <p className="px-3 py-3 text-sm text-[var(--text-secondary)]">
                      Thanks — your report was received. Posts reported by several people are hidden automatically.
                    </p>
                  ) : (
                    <>
                      <p className="flex items-center gap-2 px-3 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        <Flag className="h-3 w-3" /> Report this post
                      </p>
                      {REPORT_REASONS.map((r) => (
                        <button
                          key={r.value}
                          role="menuitem"
                          disabled={busy}
                          onClick={() => reportPost(r.value)}
                          className="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-60"
                        >
                          {r.label}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ---- owner menu ---- */}
          {post.isOwner && (
            <div ref={menuRef} className="relative ml-auto">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Post options"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-muted)] hover:text-[var(--accent)]"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-lg)]"
                >
                  <button role="menuitem" onClick={startEdit} className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
                    <Pencil className="h-4 w-4 text-[var(--text-muted)]" /> Edit post
                  </button>
                  <div className="my-1 border-t border-[var(--border-color)]" />
                  <p className="px-3 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Who can see this</p>
                  {VISIBILITY_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      role="menuitemradio"
                      aria-checked={(post.visibility ?? "public") === o.value}
                      onClick={() => changeVisibility(o.value)}
                      disabled={busy}
                      className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-60"
                    >
                      <o.Icon className="h-4 w-4 text-[var(--text-muted)]" />
                      <span className="flex-1">{o.label}</span>
                      {(post.visibility ?? "public") === o.value && <Check className="h-4 w-4 text-[var(--accent)]" />}
                    </button>
                  ))}
                  <div className="my-1 border-t border-[var(--border-color)]" />
                  <button role="menuitem" onClick={toggleComments} disabled={busy} className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-60">
                    {post.commentsEnabled === false
                      ? <><MessageCircle className="h-4 w-4 text-[var(--text-muted)]" /> Turn comments on</>
                      : <><MessageCircleOff className="h-4 w-4 text-[var(--text-muted)]" /> Turn comments off</>}
                  </button>
                  <div className="my-1 border-t border-[var(--border-color)]" />
                  {confirmDelete ? (
                    <div className="px-3 py-2">
                      <p className="mb-2 text-xs text-[var(--text-secondary)]">Delete this post? This can&apos;t be undone.</p>
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setConfirmDelete(false)} className="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]">Cancel</button>
                        <button onClick={deletePost} disabled={busy} className="cursor-pointer rounded-lg bg-[var(--danger)] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60">
                          {busy ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button role="menuitem" onClick={() => setConfirmDelete(true)} className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)]">
                      <Trash2 className="h-4 w-4" /> Delete post
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---- body ---- */}
        {editing ? (
          <div className="mt-2 rounded-xl border border-[var(--accent-ring)] bg-[var(--bg-app)] p-3">
            <textarea
              autoFocus
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              rows={3}
              maxLength={1000}
              className="w-full resize-y bg-transparent text-[15px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              placeholder="Edit your post…"
            />
            <AttachmentPreviews
              attachments={draftMedia}
              onRemove={(id) => setDraftMedia((prev) => prev.filter((a) => a.localId !== id))}
            />
            {error && <p className="mb-2 text-xs text-[var(--danger)]">{error}</p>}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                className="flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={busy}
                className="flex cursor-pointer items-center gap-1 rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-bold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                <Check className="h-3.5 w-3.5" /> {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <>
            {post.text && (
              <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[var(--text-primary)]">{post.text}</p>
            )}
            <PostAttachments media={post.media} />
            {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
          </>
        )}

        {/* ---- actions ---- */}
        {!editing && (
          <div className="mt-2 flex max-w-[420px] items-center justify-between">
            <ActionButton
              icon={post.commentsEnabled === false ? <MessageCircleOff className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
              count={post.replies}
              active={commentsOpen}
              activeClass="text-[var(--accent)] bg-[var(--accent-muted)]"
              label={post.commentsEnabled === false ? "Comments are off" : "Comments"}
              onClick={() => setCommentsOpen((o) => !o)}
            />
            <ActionButton
              icon={<Repeat className="h-4 w-4" />}
              count={post.reposts}
              active={post.reposted}
              activeClass="text-[var(--color-online)]"
              label="Repost"
              onClick={() => onToggle(post.id, "repost")}
            />
            <ActionButton
              icon={<Heart className="h-4 w-4" style={post.liked ? { fill: "currentColor" } : undefined} />}
              count={post.likes}
              active={post.liked}
              activeClass="text-[#f43f5e]"
              label="Like"
              onClick={() => onToggle(post.id, "like")}
            />
            <ActionButton
              icon={post.bookmarked ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
              active={post.bookmarked}
              activeClass="text-[var(--accent)]"
              label="Bookmark"
              onClick={() => onToggle(post.id, "bookmark")}
            />
          </div>
        )}

        {commentsOpen && !editing && (
          <PostComments
            postId={post.id}
            commentsEnabled={post.commentsEnabled !== false}
            currentUser={currentUser}
            onCountChange={(delta) => onUpdated({ ...post, replies: Math.max(0, (post.replies || 0) + delta) })}
          />
        )}
      </div>
      </div>
    </article>
  );
}

function ActionButton({
  icon,
  count,
  active,
  activeClass = "",
  label,
  onClick,
}: {
  icon: React.ReactNode;
  count?: number;
  active?: boolean;
  activeClass?: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        "flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-colors",
        active ? activeClass : "text-[var(--text-muted)] hover:bg-[var(--accent-muted)] hover:text-[var(--accent)]",
      ].join(" ")}
    >
      {icon}
      {!!count && count > 0 && <span>{fmtNum(count)}</span>}
    </button>
  );
}
