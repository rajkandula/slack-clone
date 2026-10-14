"use client";

import { useCallback, useEffect, useState } from "react";
import { Hash, Lock, Plus, X } from "lucide-react";
import type { ActiveWorkspace } from "./ChatWorkspace";

interface ChannelRow {
  id: string;
  name: string;
  visibility: "public" | "private";
  memberCount: number;
  joined: boolean;
}

interface ChannelModalProps {
  workspace: ActiveWorkspace;
  onClose: () => void;
  /** Called after any mutation so the parent can refresh its chat list. */
  onChanged: () => void;
  /** Called with the chat id when the user opens or joins a channel. */
  onOpenChannel: (chatId: string) => void;
}

/**
 * Workspace channel browser + creator: every public channel in the
 * workspace, one click to open (or rejoin), and an inline create form.
 */
export default function ChannelModal({
  workspace,
  onClose,
  onChanged,
  onOpenChannel,
}: ChannelModalProps) {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrivate, setNewPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/workspaces/channels?workspaceId=${workspace.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load channels");
      setChannels(data.channels);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    // Defer the initial load a tick so no state is set synchronously in the effect.
    const t = setTimeout(loadChannels, 0);
    return () => clearTimeout(t);
  }, [loadChannels]);

  const openOrJoin = async (channel: ChannelRow) => {
    setError("");
    try {
      if (!channel.joined) {
        const res = await fetch("/api/workspaces/channels", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: channel.id }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Could not join channel");
        }
        onChanged();
      }
      onOpenChannel(channel.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join channel");
    }
  };

  const createChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/workspaces/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          name: newName,
          visibility: newPrivate ? "private" : "public",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create channel");
      setNewName("");
      setCreating(false);
      onChanged();
      onOpenChannel(data.channel.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create channel");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--layer-scrim)] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div>
            <h2 className="text-[15px] font-bold text-[var(--text-primary)]">Channels</h2>
            <p className="text-xs text-[var(--text-muted)]">{workspace.name}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Channel list */}
        <div className="max-h-80 overflow-y-auto px-2 py-2">
          {loading ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
              Loading channels…
            </p>
          ) : channels.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
              No channels yet — create the first one below.
            </p>
          ) : (
            channels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => openOrJoin(ch)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)]">
                  {ch.visibility === "private" ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <Hash className="h-4 w-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                    {ch.name}
                  </span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {ch.memberCount} member{ch.memberCount === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="text-xs font-semibold text-[var(--accent)]">
                  {ch.joined ? "Open" : "Join"}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Create */}
        <div className="border-t border-[var(--border-color)] px-5 py-4">
          {creating ? (
            <form onSubmit={createChannel} className="flex flex-col gap-3">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="channel-name"
                maxLength={50}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setNewPrivate(false)}
                  aria-pressed={!newPrivate}
                  className={["flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-left", !newPrivate ? "border-[var(--accent)] bg-[var(--accent-muted)]" : "border-[var(--border-color)] bg-[var(--bg-surface)]"].join(" ")}
                >
                  <Hash className={`mt-0.5 h-3.5 w-3.5 ${!newPrivate ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`} />
                  <span><span className="block text-xs font-semibold text-[var(--text-primary)]">Open</span><span className="block text-[11px] text-[var(--text-muted)]">Everyone in {workspace.name} sees it and is added automatically</span></span>
                </button>
                <button
                  type="button"
                  onClick={() => setNewPrivate(true)}
                  aria-pressed={newPrivate}
                  className={["flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-left", newPrivate ? "border-[var(--accent)] bg-[var(--accent-muted)]" : "border-[var(--border-color)] bg-[var(--bg-surface)]"].join(" ")}
                >
                  <Lock className={`mt-0.5 h-3.5 w-3.5 ${newPrivate ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`} />
                  <span><span className="block text-xs font-semibold text-[var(--text-primary)]">Invite-only</span><span className="block text-[11px] text-[var(--text-muted)]">Only members you add can see it</span></span>
                </button>
              </div>
              {workspace.visibility === "private" && (
                <p className="text-[11px] text-[var(--text-muted)]">
                  <Lock className="mr-1 inline h-3 w-3 align-[-2px]" />
                  {workspace.name} is a private workspace — no one outside it can see either kind of channel.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newName.trim() || submitting}
                  className="cursor-pointer rounded-lg bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-default disabled:opacity-50"
                >
                  {submitting ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)]"
            >
              <Plus className="h-4 w-4" />
              Create a channel
            </button>
          )}
          {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
        </div>
      </div>
    </div>
  );
}
