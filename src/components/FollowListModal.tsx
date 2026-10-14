"use client";

import { useEffect, useState } from "react";
import { Loader2, Lock, X } from "lucide-react";
import { handleAvatarError, prettyAvatar } from "@/lib/avatar";
import { navigate } from "@/lib/navigate";

interface Row {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  accountPrivate: boolean;
  isSelf: boolean;
  isFollowing: boolean;
  requested: boolean;
}

interface FollowListModalProps {
  userId: string;
  type: "followers" | "following";
  title?: string;
  onClose: () => void;
}

/** Who follows a user / who they follow — rows link to profiles, with follow buttons. */
export default function FollowListModal({ userId, type, title, onClose }: FollowListModalProps) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/follow/list?userId=${userId}&type=${type}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load");
        if (!cancelled) setRows(data.users);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load");
      }
    })();
    return () => { cancelled = true; };
  }, [userId, type]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = async (row: Row) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const res = await fetch("/api/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: row.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? { ...r, isFollowing: data.following, requested: data.requested } : r)));
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--layer-scrim)] p-4" onClick={onClose}>
      <div
        className="flex h-[min(520px,85vh)] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <h2 className="text-[15px] font-bold capitalize text-[var(--text-primary)]">{title ?? type}</h2>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {error ? (
            <p className="px-5 py-10 text-center text-sm text-[var(--text-muted)]">{error}</p>
          ) : rows === null ? (
            <div className="flex justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" /></div>
          ) : rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-[var(--text-muted)]">
              {type === "followers" ? "No followers yet." : "Not following anyone yet."}
            </p>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--bg-surface-hover)]">
                <button type="button" onClick={() => { onClose(); navigate(`/u/${r.username}`); }} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
                  <img src={prettyAvatar(r.avatarUrl, r.username)} onError={(e) => handleAvatarError(e, r.username)} alt="" className="h-10 w-10 rounded-full object-cover" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-[var(--text-primary)]">
                      {r.displayName}
                      {r.accountPrivate && <Lock className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />}
                    </span>
                    <span className="block truncate text-xs text-[var(--text-muted)]">@{r.username}</span>
                  </span>
                </button>
                {!r.isSelf && (
                  <button
                    type="button"
                    onClick={() => toggle(r)}
                    disabled={busyId === r.id}
                    className={[
                      "shrink-0 cursor-pointer rounded-full px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-60",
                      r.isFollowing || r.requested
                        ? "border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--danger-border)] hover:text-[var(--danger)]"
                        : "bg-[var(--accent)] text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]",
                    ].join(" ")}
                  >
                    {r.isFollowing ? "Following" : r.requested ? "Requested" : "Follow"}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
