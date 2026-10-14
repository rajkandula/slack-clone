"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, MessageCircleOff, Pencil, Send, Trash2, X } from "lucide-react";
import { handleAvatarError, prettyAvatar } from "@/lib/avatar";
import { timeAgo } from "./PostCard";

export interface PostComment {
  id: string;
  postId: string;
  authorId: string;
  author: { username: string; displayName: string; avatarUrl: string };
  text: string;
  createdAt: string;
  editedAt?: string | null;
  isOwner: boolean;   // may edit
  canDelete: boolean; // author or post owner
}

interface PostCommentsProps {
  postId: string;
  commentsEnabled: boolean;
  currentUser: { username: string; avatarUrl: string };
  /** Called when the number of comments changes so the card can update its count. */
  onCountChange: (delta: number) => void;
}

/**
 * Threaded comments under a post: list, add, edit own, delete own — and the
 * post owner can delete anyone's. Respects the post's commentsEnabled flag.
 */
export default function PostComments({ postId, commentsEnabled, currentUser, onCountChange }: PostCommentsProps) {
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/posts/${postId}/comments`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load comments");
        if (!cancelled) setComments(data.comments);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load comments");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    setError("");
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not comment");
      setComments((prev) => [...(prev ?? []), data]);
      setDraft("");
      onCountChange(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not comment");
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async (id: string) => {
    const text = editText.trim();
    if (!text || busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/posts/${postId}/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      setComments((prev) => (prev ?? []).map((c) => (c.id === id ? { ...c, text: data.text, editedAt: data.editedAt } : c)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/posts/${postId}/comments/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not delete");
      setComments((prev) => (prev ?? []).filter((c) => c.id !== id));
      onCountChange(-1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)]">
      {/* list */}
      <div className="max-h-[360px] overflow-y-auto px-3 py-2">
        {comments === null && !error && (
          <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" /></div>
        )}
        {comments && comments.length === 0 && (
          <p className="py-4 text-center text-xs text-[var(--text-muted)]">No comments yet — start the conversation.</p>
        )}
        {comments?.map((c) => (
          <div key={c.id} className="group flex gap-2.5 py-2">
            <img
              src={prettyAvatar(c.author.avatarUrl, c.author.username)}
              onError={(e) => handleAvatarError(e, c.author.username)}
              alt=""
              className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="truncate font-semibold text-[var(--text-primary)]">{c.author.displayName}</span>
                <span className="truncate text-[var(--text-muted)]">@{c.author.username}</span>
                <span className="text-[var(--text-muted)]">· {timeAgo(c.createdAt)}</span>
                {c.editedAt && <span className="text-[var(--text-muted)]">· edited</span>}
                <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  {c.isOwner && editingId !== c.id && (
                    <button
                      type="button"
                      title="Edit comment"
                      aria-label="Edit comment"
                      onClick={() => { setEditingId(c.id); setEditText(c.text); }}
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  {c.canDelete && (
                    <button
                      type="button"
                      title={c.isOwner ? "Delete comment" : "Remove this comment from your post"}
                      aria-label="Delete comment"
                      disabled={busyId === c.id}
                      onClick={() => remove(c.id)}
                      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-50"
                    >
                      {busyId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </button>
                  )}
                </span>
              </div>
              {editingId === c.id ? (
                <div className="mt-1">
                  <textarea
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={2}
                    maxLength={500}
                    className="w-full resize-y rounded-lg border border-[var(--accent-ring)] bg-[var(--bg-app)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] outline-none"
                  />
                  <div className="mt-1 flex justify-end gap-1">
                    <button type="button" onClick={() => setEditingId(null)} className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="h-3 w-3" /> Cancel</button>
                    <button type="button" onClick={() => saveEdit(c.id)} disabled={busyId === c.id} className="flex cursor-pointer items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-[var(--text-on-accent)] disabled:opacity-60"><Check className="h-3 w-3" /> Save</button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words text-[13.5px] leading-snug text-[var(--text-primary)]">{c.text}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* composer */}
      <div className="border-t border-[var(--border-color)] px-3 py-2">
        {commentsEnabled ? (
          <div className="flex items-end gap-2">
            <img
              src={prettyAvatar(currentUser.avatarUrl, currentUser.username)}
              onError={(e) => handleAvatarError(e, currentUser.username)}
              alt=""
              className="h-7 w-7 shrink-0 rounded-full object-cover"
            />
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Write a comment… (Enter to send, Shift+Enter for a new line)"
              rows={1}
              maxLength={500}
              className="max-h-32 min-h-[34px] flex-1 resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-app)] px-3 py-1.5 text-[13.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim() || posting}
              aria-label="Post comment"
              className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--accent)] text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        ) : (
          <p className="flex items-center gap-2 py-1 text-xs text-[var(--text-muted)]">
            <MessageCircleOff className="h-3.5 w-3.5" /> Comments are turned off for this post.
          </p>
        )}
        {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </div>
  );
}
