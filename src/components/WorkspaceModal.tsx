"use client";

import { useCallback, useEffect, useState } from "react";
import { Compass, KeyRound, Plus, Users, X } from "lucide-react";

export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string;
  visibility: "public" | "private";
  memberCount: number;
  role: "owner" | "admin" | "member";
  inviteCode?: string;
}

interface DirectoryRow {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string;
  memberCount: number;
  joined: boolean;
}

type Tab = "directory" | "create" | "invite";

interface WorkspaceModalProps {
  onClose: () => void;
  /** Fires with the workspace after a create or join so the shell can switch to it. */
  onJoined: (workspace: WorkspaceSummary) => void;
}

/**
 * Entry point into workspaces: redeem an invite code, create a new workspace,
 * or jump to one you're already in. There is no public browse any more —
 * workspaces are invite-only, so nothing is discoverable by strangers.
 */
export default function WorkspaceModal({ onClose, onJoined }: WorkspaceModalProps) {
  const [tab, setTab] = useState<Tab>("invite");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Directory
  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [query, setQuery] = useState("");

  // Create
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);

  // Invite
  const [code, setCode] = useState("");

  const loadDirectory = useCallback(async (q: string) => {
    setLoadingRows(true);
    try {
      const res = await fetch(
        `/api/workspaces/directory${q ? `?q=${encodeURIComponent(q)}` : ""}`
      );
      const data = await res.json();
      if (res.ok) setRows(data.workspaces);
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadDirectory(query), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, loadDirectory]);

  /**
   * The directory now only ever lists workspaces you already belong to, so
   * this opens one rather than joining it — joining requires an invite code.
   * The row is a trimmed listing shape, so resolve the full record (role and
   * visibility included) before handing it to the shell.
   */
  const openWorkspace = async (workspaceId: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/workspaces");
      const data = await res.json();
      const full = (data.workspaces ?? []).find(
        (w: WorkspaceSummary) => w.id === workspaceId
      );
      if (!full) throw new Error("Could not open that workspace");
      onJoined(full);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that workspace");
    } finally {
      setBusy(false);
    }
  };

  const redeemInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/workspaces/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid invite code");
      onJoined(data.workspace);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid invite code");
    } finally {
      setBusy(false);
    }
  };

  const createWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          visibility: isPrivate ? "private" : "public",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create workspace");
      onJoined(data.workspace);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create workspace");
    } finally {
      setBusy(false);
    }
  };

  const TABS: Array<{ id: Tab; label: string; Icon: typeof Compass }> = [
    { id: "directory", label: "Your workspaces", Icon: Compass },
    { id: "create", label: "Create", Icon: Plus },
    { id: "invite", label: "Invite code", Icon: KeyRound },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--layer-scrim)] p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[min(520px,85vh)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <h2 className="text-[15px] font-bold text-[var(--text-primary)]">Workspaces</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--border-color)] px-3 pt-2">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => {
                setTab(id);
                setError("");
              }}
              className={[
                "flex cursor-pointer items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-medium",
                "border-b-2 transition-colors",
                tab === id
                  ? "border-[var(--accent)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]",
              ].join(" ")}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {tab === "directory" && (
            <div className="flex flex-col gap-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search public workspaces…"
                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <div className="max-h-64 overflow-y-auto">
                {loadingRows ? (
                  <p className="py-6 text-center text-sm text-[var(--text-muted)]">Loading…</p>
                ) : rows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[var(--text-muted)]">
                    No public workspaces{query ? " match your search" : " yet — create the first one!"}
                  </p>
                ) : (
                  rows.map((ws) => (
                    <div
                      key={ws.id}
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--bg-surface-hover)]"
                    >
                      <img src={ws.avatarUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                          {ws.name}
                        </p>
                        <p className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                          <Users className="h-3 w-3" />
                          {ws.memberCount} member{ws.memberCount === 1 ? "" : "s"}
                          {ws.description ? ` · ${ws.description}` : ""}
                        </p>
                      </div>
                      <button
                        onClick={() => openWorkspace(ws.id)}
                        disabled={busy}
                        className="cursor-pointer rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
                      >
                        Open
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === "create" && (
            <form onSubmit={createWorkspace} className="flex flex-col gap-3">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Workspace name"
                maxLength={60}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this workspace about? (optional)"
                rows={2}
                className="resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                Private — joinable only with the invite code
              </label>
              <button
                type="submit"
                disabled={!name.trim() || busy}
                className="cursor-pointer rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-default disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create workspace"}
              </button>
            </form>
          )}

          {tab === "invite" && (
            <form onSubmit={redeemInvite} className="flex flex-col gap-3">
              <p className="text-sm text-[var(--text-secondary)]">
                Paste an invite code to join a workspace — you&apos;ll get all of its
                public channels right away.
              </p>
              <input
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. 5020f240"
                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <button
                type="submit"
                disabled={!code.trim() || busy}
                className="cursor-pointer rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-default disabled:opacity-50"
              >
                {busy ? "Joining…" : "Join workspace"}
              </button>
            </form>
          )}

          {error && <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>}
        </div>
      </div>
    </div>
  );
}
