"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, LayoutGrid, MessageSquare, Plus, Search, Users } from "lucide-react";
import { handleAvatarError } from "@/lib/avatar";
import type { WorkspaceSummary } from "./WorkspaceModal";

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceSummary[];
  /** null = Personal */
  activeWorkspaceId: string | null;
  onSelectPersonal: () => void;
  onSelectWorkspace: (id: string) => void;
  onAddWorkspace: () => void;
}

const SEARCH_THRESHOLD = 6;

/**
 * Single rail control for switching between Personal and any number of
 * workspaces. Shows the active workspace's avatar (or a grid icon when in
 * Personal) and opens a popover with the full list — searchable once the
 * list grows — so the rail never fills up with bubbles.
 */
export default function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onSelectPersonal,
  onSelectWorkspace,
  onAddWorkspace,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Focus search when the list is long enough to need it.
  useEffect(() => {
    if (open && workspaces.length >= SEARCH_THRESHOLD) {
      const t = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open, workspaces.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter((w) => w.name.toLowerCase().includes(q));
  }, [workspaces, query]);

  const choose = (fn: () => void) => {
    fn();
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={rootRef} className="relative">
      {/* ---- Trigger ---- */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={active ? `Workspace: ${active.name}. Switch workspace` : "Switch workspace"}
        title={active ? active.name : "Workspaces"}
        className={[
          "group relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl transition-colors",
          active || open
            ? "bg-[var(--accent-muted)]"
            : "text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]",
        ].join(" ")}
      >
        {active ? (
          <img
            src={active.avatarUrl}
            alt=""
            onError={(e) => handleAvatarError(e, active.name)}
            className="h-8 w-8 rounded-lg object-cover"
          />
        ) : (
          <LayoutGrid className="h-[19px] w-[19px]" strokeWidth={2} />
        )}
        {active && (
          <span className="absolute -left-3 h-5 w-1 rounded-r-full bg-[var(--accent)]" />
        )}
        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-elevated)] text-[var(--text-muted)] shadow-[var(--shadow-sm)]">
          <ChevronsUpDown className="h-2.5 w-2.5" strokeWidth={2.5} />
        </span>
      </button>

      {/* ---- Popover ---- */}
      {open && (
        <div
          role="listbox"
          aria-label="Workspaces"
          className="rail-popover absolute left-full top-0 z-50 ml-3 w-72 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
        >
          <div className="border-b border-[var(--border-color)] px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Switch to
            </p>
          </div>

          {workspaces.length >= SEARCH_THRESHOLD && (
            <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-3 py-2">
              <Search className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a workspace…"
                className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
            </div>
          )}

          <div className="max-h-80 overflow-y-auto py-1">
            {/* Personal */}
            {!query && (
              <button
                role="option"
                aria-selected={!activeWorkspaceId}
                onClick={() => choose(onSelectPersonal)}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-muted)] text-[var(--accent)]">
                  <MessageSquare className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                    Personal
                  </span>
                  <span className="block text-xs text-[var(--text-muted)]">DMs &amp; groups</span>
                </span>
                {!activeWorkspaceId && <Check className="h-4 w-4 text-[var(--accent)]" />}
              </button>
            )}

            {filtered.map((ws) => {
              const isActive = ws.id === activeWorkspaceId;
              return (
                <button
                  key={ws.id}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => choose(() => onSelectWorkspace(ws.id))}
                  className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
                >
                  <img
                    src={ws.avatarUrl}
                    alt=""
                    onError={(e) => handleAvatarError(e, ws.name)}
                    className="h-8 w-8 rounded-lg object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                      {ws.name}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                      <Users className="h-3 w-3" />
                      {ws.memberCount} member{ws.memberCount === 1 ? "" : "s"}
                      {ws.visibility === "private" ? " · Private" : ""}
                    </span>
                  </span>
                  {isActive && <Check className="h-4 w-4 text-[var(--accent)]" />}
                </button>
              );
            })}

            {filtered.length === 0 && query && (
              <p className="px-3 py-4 text-center text-sm text-[var(--text-muted)]">
                No workspace matches “{query}”
              </p>
            )}
          </div>

          <button
            onClick={() => choose(onAddWorkspace)}
            className="flex w-full cursor-pointer items-center gap-2 border-t border-[var(--border-color)] px-3 py-2.5 text-sm font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--bg-surface-hover)]"
          >
            <Plus className="h-4 w-4" />
            Add a workspace
          </button>
        </div>
      )}
    </div>
  );
}
