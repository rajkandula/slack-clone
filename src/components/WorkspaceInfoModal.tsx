"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  Copy,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { handleAvatarError, prettyAvatar } from "@/lib/avatar";
import type { WorkspaceSummary } from "./WorkspaceModal";

interface MemberRow {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  status: string;
  role: "owner" | "admin" | "member";
  isSelf: boolean;
}

interface WorkspaceInfoModalProps {
  workspace: WorkspaceSummary;
  currentUserId: string;
  onClose: () => void;
  /** Called with the updated workspace after a settings change. */
  onUpdated: (ws: WorkspaceSummary) => void;
  /** Called after the current user leaves. */
  onLeft: () => void;
}

/**
 * Everything about one workspace in one place: overview, invite code,
 * members (with owner/admin moderation), and admin settings.
 */
export default function WorkspaceInfoModal({ workspace, currentUserId, onClose, onUpdated, onLeft }: WorkspaceInfoModalProps) {
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const isOwner = workspace.role === "owner";

  const [tab, setTab] = useState<"about" | "members" | "settings">("about");
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // settings form
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description || "");
  const [visibility, setVisibility] = useState<"public" | "private">(workspace.visibility);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const changeAvatar = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
      setError("Please choose an image");
      return;
    }
    setBusy("avatar");
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/media/upload", { method: "POST", body: fd });
      const upData = await up.json();
      if (!up.ok) throw new Error(upData.error || "Upload failed");
      const res = await fetch("/api/workspaces", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id, avatarUrl: upData.mediaUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update image");
      onUpdated(data.workspace);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update image");
    } finally {
      setBusy(null);
    }
  };

  const loadMembers = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/members?workspaceId=${workspace.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load members");
      setMembers(data.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load members");
    }
  }, [workspace.id]);

  useEffect(() => {
    const t = setTimeout(loadMembers, 0);
    return () => clearTimeout(t);
  }, [loadMembers]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patch = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      onUpdated(data.workspace);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(null);
    }
  };

  const copyInvite = async () => {
    if (!workspace.inviteCode) return;
    try {
      await navigator.clipboard.writeText(workspace.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  const changeRole = async (userId: string, role: "admin" | "member") => {
    setBusy(userId);
    setError("");
    try {
      const res = await fetch("/api/workspaces/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id, userId, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update role");
      setMembers((prev) => (prev ?? []).map((m) => (m.userId === userId ? { ...m, role } : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update role");
    } finally {
      setBusy(null);
    }
  };

  const removeMember = async (userId: string, self: boolean) => {
    setBusy(userId);
    setError("");
    try {
      const res = await fetch(`/api/workspaces/members?workspaceId=${workspace.id}&userId=${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not remove");
      if (self) {
        onLeft();
      } else {
        setMembers((prev) => (prev ?? []).filter((m) => m.userId !== userId));
        onUpdated({ ...workspace, memberCount: Math.max(0, workspace.memberCount - 1) });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove");
    } finally {
      setBusy(null);
    }
  };

  const TABS: Array<{ id: typeof tab; label: string }> = [
    { id: "about", label: "About" },
    { id: "members", label: `Members${members ? ` · ${members.length}` : ""}` },
    ...(isAdmin ? [{ id: "settings" as const, label: "Settings" }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--layer-scrim)] p-4" onClick={onClose}>
      <div
        className="flex h-[min(640px,85vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-5 py-4">
          <div className="relative shrink-0">
            <img
              src={workspace.avatarUrl}
              alt=""
              onError={(e) => handleAvatarError(e, workspace.name)}
              className="h-12 w-12 rounded-xl object-cover"
            />
            {isAdmin && (
              <>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*,.heic,.heif"
                  className="hidden"
                  onChange={(e) => {
                    changeAvatar(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={busy === "avatar"}
                  title="Change workspace image"
                  aria-label="Change workspace image"
                  className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-[var(--bg-elevated)] bg-[var(--accent)] text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
                >
                  {busy === "avatar" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
                </button>
              </>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-bold text-[var(--text-primary)]">{workspace.name}</h2>
            <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              {workspace.visibility === "private" ? <Lock className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
              {workspace.visibility === "private" ? "Private workspace" : "Public workspace"}
              <span>·</span>
              <Users className="h-3 w-3" /> {workspace.memberCount} member{workspace.memberCount === 1 ? "" : "s"}
              <span>·</span>
              <span className="capitalize">you&apos;re {workspace.role}</span>
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* tabs */}
        <div className="flex gap-1 border-b border-[var(--border-color)] px-3 pt-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                "cursor-pointer rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                tab === t.id ? "border-[var(--accent)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <p className="mx-5 mt-3 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">{error}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {/* ---------- ABOUT ---------- */}
          {tab === "about" && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Description</p>
                <p className="text-sm text-[var(--text-primary)]">{workspace.description || <span className="text-[var(--text-muted)]">No description yet.</span>}</p>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Invite people</p>
                <p className="mb-2 text-xs text-[var(--text-muted)]">
                  Share this code — anyone who redeems it joins the workspace and every open channel.
                </p>
                <div className="flex items-center gap-2">
                  <span className="flex flex-1 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-sm text-[var(--text-primary)]">
                    <KeyRound className="h-4 w-4 text-[var(--text-muted)]" /> {workspace.inviteCode}
                  </span>
                  <button onClick={copyInvite} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => patch({ regenerateInvite: true }, "invite")}
                      disabled={busy === "invite"}
                      title="Generate a new code (the old one stops working)"
                      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-60"
                    >
                      {busy === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3 text-xs text-[var(--text-secondary)]">
                <p className="mb-1 font-semibold text-[var(--text-primary)]">How channels work here</p>
                <p>
                  {workspace.visibility === "private"
                    ? "This workspace is private: nobody outside it can see or find any channel. "
                    : "This workspace is listed publicly and anyone can join it. "}
                  Inside, an <strong>open</strong> channel is visible to every member; an <strong>invite-only</strong> channel is visible only to the people added to it.
                </p>
              </div>

              {!isOwner && (
                <div className="border-t border-[var(--border-color)] pt-4">
                  {confirmLeave ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-[var(--text-secondary)]">Leave {workspace.name}? You&apos;ll lose access to its channels.</p>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmLeave(false)} className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)]">Cancel</button>
                        <button onClick={() => removeMember(currentUserId, true)} disabled={!!busy} className="cursor-pointer rounded-lg bg-[var(--danger)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">Leave</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmLeave(true)} className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--danger)] hover:underline">
                      <LogOut className="h-4 w-4" /> Leave workspace
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ---------- MEMBERS ---------- */}
          {tab === "members" && (
            <div>
              {members === null ? (
                <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" /></div>
              ) : (
                <ul className="flex flex-col">
                  {members.map((m) => (
                    <li key={m.userId} className="flex items-center gap-3 py-2">
                      <img src={prettyAvatar(m.avatarUrl, m.username)} onError={(e) => handleAvatarError(e, m.username)} alt="" className="h-9 w-9 rounded-full object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-sm font-semibold text-[var(--text-primary)]">
                          {m.displayName}{m.isSelf ? " (you)" : ""}
                          {m.role !== "member" && (
                            <span className="rounded-md border border-[var(--accent-ring)] px-1.5 py-px text-[10px] font-bold uppercase text-[var(--accent)]">{m.role}</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-[var(--text-muted)]">@{m.username} · {m.status}</p>
                      </div>
                      {!m.isSelf && m.role !== "owner" && (
                        <div className="flex items-center gap-1">
                          {isOwner && (
                            <button
                              onClick={() => changeRole(m.userId, m.role === "admin" ? "member" : "admin")}
                              disabled={busy === m.userId}
                              className="flex cursor-pointer items-center gap-1 rounded-full border border-[var(--border-color)] px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:border-[var(--accent-ring)] hover:text-[var(--accent)] disabled:opacity-60"
                            >
                              {m.role === "admin" ? <><ShieldOff className="h-3.5 w-3.5" /> Remove admin</> : <><ShieldCheck className="h-3.5 w-3.5" /> Make admin</>}
                            </button>
                          )}
                          {(isOwner || (isAdmin && m.role === "member")) && (
                            <button
                              onClick={() => removeMember(m.userId, false)}
                              disabled={busy === m.userId}
                              title="Remove from workspace"
                              aria-label="Remove from workspace"
                              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] disabled:opacity-60"
                            >
                              {busy === m.userId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ---------- SETTINGS (admins) ---------- */}
          {tab === "settings" && isAdmin && (
            <div className="flex flex-col gap-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">Workspace name</span>
                <div className="flex gap-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
                  <button onClick={() => patch({ name }, "name")} disabled={busy === "name" || !name.trim() || name.trim() === workspace.name} className="cursor-pointer rounded-lg bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--text-on-accent)] disabled:opacity-50">Save</button>
                </div>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--text-secondary)]">Description</span>
                <div className="flex gap-2">
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={200} className="flex-1 resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
                  <button onClick={() => patch({ description }, "description")} disabled={busy === "description" || description === (workspace.description || "")} className="cursor-pointer self-start rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--text-on-accent)] disabled:opacity-50">Save</button>
                </div>
              </label>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-[var(--text-secondary)]">Who can find and join</p>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: "private", Icon: Lock, t: "Private", h: "Invite code only. Not listed anywhere." },
                    { v: "public", Icon: Globe, t: "Public", h: "Listed in Discover; anyone can join." },
                  ] as const).map((o) => (
                    <button
                      key={o.v}
                      onClick={() => { setVisibility(o.v); patch({ visibility: o.v }, "visibility"); }}
                      aria-pressed={visibility === o.v}
                      className={["flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-left", visibility === o.v ? "border-[var(--accent)] bg-[var(--accent-muted)]" : "border-[var(--border-color)] bg-[var(--bg-surface)] hover:border-[var(--accent-ring)]"].join(" ")}
                    >
                      <o.Icon className={`mt-0.5 h-4 w-4 ${visibility === o.v ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`} />
                      <span><span className="block text-sm font-semibold text-[var(--text-primary)]">{o.t}</span><span className="block text-[11px] text-[var(--text-muted)]">{o.h}</span></span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
