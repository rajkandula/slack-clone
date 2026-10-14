"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity, ArrowLeft, Inbox, Loader2, Lock, Mail, MailCheck,
  MessageSquare, Phone, Search, ShieldCheck, Users as UsersIcon,
} from "lucide-react";
import WaspMark from "@/components/WaspMark";

/* Company dashboard — /admin. Server-side role checks live on every
   /api/admin endpoint; this page is just the window onto them. */

interface Overview {
  totals: { users: number; messages: number; posts: number; chats: number; workspaces: number; calls: number; pushSubs: number };
  today: { newUsers: number; messages: number; activeNow: number };
  inbox: { open: number };
  signups14d: { day: string; count: number }[];
}
interface AdminUser {
  id: string; username: string; displayName: string; email: string;
  role: string | null; accountPrivate: boolean; emailVerified: boolean;
  createdAt: string; lastSeen: string | null;
}
interface ContactMsg { id: string; name: string; email: string; message: string; handled: boolean; createdAt: string }

const card = "rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)]";

export default function AdminPage() {
  const [tab, setTab] = useState<"overview" | "users" | "inbox">("overview");
  const [authState, setAuthState] = useState<"loading" | "denied" | "ok">("loading");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState("");
  const [inbox, setInbox] = useState<ContactMsg[]>([]);

  useEffect(() => {
    fetch("/api/admin/overview").then(async (r) => {
      if (!r.ok) { setAuthState("denied"); return; }
      setOverview(await r.json());
      setAuthState("ok");
    }).catch(() => setAuthState("denied"));
  }, []);

  const loadUsers = useCallback((query: string) => {
    fetch(`/api/admin/users?q=${encodeURIComponent(query)}`)
      .then((r) => r.json()).then((d) => setUsers(d.users || [])).catch(() => {});
  }, []);
  const loadInbox = useCallback(() => {
    fetch("/api/admin/contact").then((r) => r.json()).then((d) => setInbox(d.messages || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (authState !== "ok") return;
    if (tab === "users") loadUsers(q);
    if (tab === "inbox") loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, authState]);

  const markHandled = async (id: string, handled: boolean) => {
    setInbox((prev) => prev.map((m) => (m.id === id ? { ...m, handled } : m)));
    await fetch("/api/admin/contact", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, handled }),
    }).catch(() => {});
  };

  if (authState === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-[var(--bg-app)]"><Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" /></div>;
  }
  if (authState === "denied") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--bg-app)] px-6 text-center">
        <Lock className="h-8 w-8 text-[var(--text-muted)]" aria-hidden />
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Staff only</h1>
        <p className="max-w-sm text-sm text-[var(--text-secondary)]">This dashboard is for WASP administrators. If that&apos;s you, sign in with your admin account.</p>
        <Link href="/login" className="cursor-pointer rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]">Sign in</Link>
      </div>
    );
  }

  const o = overview!;
  const maxSignups = Math.max(1, ...o.signups14d.map((d) => d.count));
  const stats: [string, number, React.ElementType][] = [
    ["Users", o.totals.users, UsersIcon],
    ["Active now", o.today.activeNow, Activity],
    ["New today", o.today.newUsers, ShieldCheck],
    ["Messages", o.totals.messages, MessageSquare],
    ["Msgs today", o.today.messages, MessageSquare],
    ["Posts", o.totals.posts, Mail],
    ["Workspaces", o.totals.workspaces, UsersIcon],
    ["Calls", o.totals.calls, Phone],
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-color)] bg-[var(--bg-surface)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <Link href="/messages" aria-label="Back to WASP" className="cursor-pointer rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"><ArrowLeft className="h-4 w-4" /></Link>
            <WaspMark size={26} />
            <span className="font-bold">WASP Admin</span>
          </div>
          <nav className="flex gap-1">
            {([["overview", "Overview", Activity], ["users", "Users", UsersIcon], ["inbox", "Inbox", Inbox]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" onClick={() => setTab(id)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors duration-200 ${tab === id ? "bg-[var(--accent)] text-[var(--text-on-accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"}`}>
                <Icon className="h-4 w-4" aria-hidden />{label}
                {id === "inbox" && o.inbox.open > 0 && <span className="rounded-full bg-[var(--danger)] px-1.5 text-[10px] font-bold text-white">{o.inbox.open}</span>}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        {tab === "overview" && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {stats.map(([label, value, Icon]) => (
                <div key={label} className={`${card} p-4`}>
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]"><Icon className="h-3.5 w-3.5" aria-hidden />{label}</p>
                  <p className="mt-1 text-2xl font-extrabold">{value.toLocaleString()}</p>
                </div>
              ))}
            </div>
            <div className={`${card} mt-6 p-5`}>
              <h2 className="text-sm font-bold">Signups — last 14 days</h2>
              {o.signups14d.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--text-muted)]">No signups in this window yet.</p>
              ) : (
                <div className="mt-4 flex h-32 items-end gap-1.5">
                  {o.signups14d.map((d) => (
                    <div key={d.day} className="group flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.count}`}>
                      <span className="text-[10px] font-semibold text-[var(--text-muted)]">{d.count}</span>
                      <div className="w-full rounded-t bg-[var(--accent)] transition-colors group-hover:bg-[var(--accent-hover)]" style={{ height: `${(d.count / maxSignups) * 88 + 4}px` }} />
                      <span className="text-[9px] text-[var(--text-muted)]">{d.day.slice(5)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="mt-4 text-xs text-[var(--text-muted)]">Push-enabled devices: {o.totals.pushSubs} · Total conversations: {o.totals.chats}</p>
          </>
        )}

        {tab === "users" && (
          <>
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2">
              <Search className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadUsers(q)}
                placeholder="Search username, email or name — Enter to search"
                className="w-full bg-transparent text-sm outline-none" />
            </div>
            <div className={`${card} mt-4 overflow-x-auto`}>
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-left text-xs text-[var(--text-muted)]">
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Email</th>
                    <th className="px-4 py-3 font-semibold">Joined</th>
                    <th className="px-4 py-3 font-semibold">Last seen</th>
                    <th className="px-4 py-3 font-semibold">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-[var(--border-color)] last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-semibold">{u.displayName || u.username}</p>
                        <p className="text-xs text-[var(--text-muted)]">@{u.username}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5">{u.email || "—"}
                          {u.emailVerified && <MailCheck className="h-3.5 w-3.5 text-[var(--color-online)]" aria-label="verified" />}</span>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{u.lastSeen ? new Date(u.lastSeen).toLocaleString() : "—"}</td>
                      <td className="px-4 py-3">
                        <span className="flex gap-1.5">
                          {u.role === "admin" && <span className="rounded-full bg-[var(--accent-muted)] px-2 py-0.5 text-[10px] font-bold text-[var(--accent)]">ADMIN</span>}
                          {u.accountPrivate && <span className="rounded-full bg-[var(--layer-2)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-muted)]">PRIVATE</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">No users match.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "inbox" && (
          <div className="space-y-4">
            {inbox.length === 0 && <div className={`${card} p-8 text-center text-sm text-[var(--text-muted)]`}>No contact messages yet. When someone writes in from the contact page, it lands here.</div>}
            {inbox.map((m) => (
              <div key={m.id} className={`${card} p-5 ${m.handled ? "opacity-60" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">{m.name} <a href={`mailto:${m.email}`} className="cursor-pointer text-sm font-semibold text-[var(--accent)] hover:underline">{m.email}</a></p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">{new Date(m.createdAt).toLocaleString()}</p>
                  </div>
                  <button type="button" onClick={() => markHandled(m.id, !m.handled)}
                    className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${m.handled ? "bg-[var(--layer-2)] text-[var(--text-secondary)] hover:bg-[var(--layer-3)]" : "bg-[var(--accent)] text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"}`}>
                    {m.handled ? "Reopen" : "Mark handled"}
                  </button>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">{m.message}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
