"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, Check, Compass, Home, LogOut, MessageSquare, Plus, Settings, User, X } from "lucide-react";
import ChatWorkspace, { ActiveWorkspace } from "./ChatWorkspace";
import InstallPrompt from "./InstallPrompt";
import WorkspaceOnboarding from "./WorkspaceOnboarding";
import HomeFeed from "./HomeFeed";
import ExplorePage from "./ExplorePage";
import NotificationsPage from "./NotificationsPage";
import ProfilePage from "./ProfilePage";
import WaspMark from "./WaspMark";
import WorkspaceModal, { WorkspaceSummary } from "./WorkspaceModal";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import SettingsPage from "./SettingsPage";
import WorkspaceInfoModal from "./WorkspaceInfoModal";
import UserProfilePage from "./UserProfilePage";
import { navigate } from "@/lib/navigate";
import { getSavedAccounts, removeAccount, saveAccount, SavedAccount } from "@/lib/accounts";
import { handleAvatarError, prettyAvatar } from "@/lib/avatar";
import { syncPushSubscription } from "@/lib/push-client";

export interface WaspUser {
  id: string;
  username: string;
  avatarUrl: string;
  status: string;
  displayName?: string | null;
  email?: string | null;
  preferences?: { defaultPostVisibility?: "public" | "followers" | "private" };
  accountPrivate?: boolean;
  emailVerified?: boolean;
}

interface WaspShellProps {
  currentUser: WaspUser;
  onLogout: () => void;
  onUserUpdate: (user: WaspUser) => void;
}

const NAV_ITEMS = [
  { id: "messages", icon: MessageSquare, label: "Messages" },
  { id: "home", icon: Home, label: "Home" },
  { id: "explore", icon: Compass, label: "Explore" },
  { id: "notifications", icon: Bell, label: "Notifications" },
  { id: "profile", icon: User, label: "Profile" },
] as const;

type ViewId = (typeof NAV_ITEMS)[number]["id"] | "settings";

const VIEW_PATHS: Record<ViewId, string> = {
  messages: "/messages",
  home: "/home",
  explore: "/explore",
  notifications: "/notifications",
  profile: "/profile",
  settings: "/settings",
};

/** Parse the current pathname into a view + optional workspace id / username. */
function parseRoute(pathname: string): { view: ViewId | "user"; workspaceId: string | null; username: string | null } {
  const seg = pathname.split("/").filter(Boolean);
  if (seg[0] === "w" && seg[1]) return { view: "messages", workspaceId: seg[1], username: null };
  if (seg[0] === "u" && seg[1]) return { view: "user", workspaceId: null, username: decodeURIComponent(seg[1]) };
  const hit = (Object.keys(VIEW_PATHS) as ViewId[]).find((v) => VIEW_PATHS[v] === `/${seg[0] ?? ""}`);
  return { view: hit ?? "messages", workspaceId: null, username: null };
}


/**
 * The application frame: a narrow icon rail plus the active view.
 *
 * Rail layout, top to bottom: brand, primary views (Messages = Personal
 * chats), then the user's workspaces, then identity. Personal chats and
 * workspaces are hard-separated containers — Messages always shows personal
 * DMs/groups, a workspace bubble always shows only that workspace's channels.
 */
export default function WaspShell({ currentUser, onLogout, onUserUpdate }: WaspShellProps) {
  const pathname = usePathname();
  const route = useMemo(() => parseRoute(pathname || "/"), [pathname]);
  const activeView = route.view;
  const activeWorkspaceId = route.workspaceId;
  const profileUsername = route.username;

  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [isWorkspaceInfoOpen, setIsWorkspaceInfoOpen] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [switching, setSwitching] = useState<string | null>(null);

  // Keep this account's card fresh in the device account list, and load the others.
  // A device that already granted notifications must follow the signed-in
  // account — otherwise pushes keep going to whoever enabled them first.
  useEffect(() => {
    syncPushSubscription();
  }, [currentUser.id]);

  useEffect(() => {
    saveAccount({ id: currentUser.id, username: currentUser.username, displayName: currentUser.displayName, avatarUrl: currentUser.avatarUrl });
    setSavedAccounts(getSavedAccounts());
  }, [currentUser.id, currentUser.username, currentUser.displayName, currentUser.avatarUrl]);

  const switchAccount = async (acc: SavedAccount) => {
    if (acc.id === currentUser.id || switching) return;
    setSwitching(acc.id);
    try {
      const res = await fetch("/api/auth/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: acc.token }),
      });
      if (!res.ok) {
        // Expired or removed — drop it and send the user to sign in again.
        removeAccount(acc.id);
        setSavedAccounts(getSavedAccounts());
        window.location.assign("/login?add=1");
        return;
      }
      // Full reload so every per-account client state starts clean.
      window.location.assign("/");
    } finally {
      setSwitching(null);
    }
  };

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setUnreadNotifs(data.filter((n: { read?: boolean }) => !n.read).length);
      }
    } catch {
      /* transient — the next poll will catch up */
    }
  }, []);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces");
      if (!res.ok) return;
      const data = await res.json();
      setWorkspaces(data.workspaces ?? []);
    } catch {
      /* transient */
    } finally {
      setWorkspacesLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Kick off the initial loads asynchronously (no sync setState in effect).
    const initial = setTimeout(() => {
      fetchUnreadCount();
      fetchWorkspaces();
    }, 0);
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [fetchUnreadCount, fetchWorkspaces]);

  const handleNavClick = (id: ViewId) => {
    navigate(VIEW_PATHS[id]);
    if (id === "notifications") setUnreadNotifs(0);
  };

  const handleWorkspaceClick = (id: string) => {
    navigate(`/w/${id}`);
  };

  // If the URL names a workspace we are not (or no longer) a member of, fall
  // back to Personal once the list has loaded rather than showing nothing.
  useEffect(() => {
    if (workspacesLoaded && activeWorkspaceId && !workspaces.some((w) => w.id === activeWorkspaceId)) {
      window.history.replaceState(null, "", VIEW_PATHS.messages);
    }
  }, [workspacesLoaded, activeWorkspaceId, workspaces]);

  const handleJoined = (ws: WorkspaceSummary) => {
    setIsWorkspaceModalOpen(false);
    setWorkspaces((prev) => {
      const without = prev.filter((w) => w.id !== ws.id);
      return [...without, ws];
    });
    handleWorkspaceClick(ws.id);
  };

  const chatWorkspaceProp: ActiveWorkspace | null = activeWorkspace
    ? {
        id: activeWorkspace.id,
        name: activeWorkspace.name,
        role: activeWorkspace.role,
        inviteCode: activeWorkspace.inviteCode,
        description: activeWorkspace.description,
        avatarUrl: activeWorkspace.avatarUrl,
        visibility: activeWorkspace.visibility,
        memberCount: activeWorkspace.memberCount,
      }
    : null;

  const messagesActive = activeView === "messages" && !activeWorkspace;

  // WASP is invite-only: with no workspace there is nobody to see and nothing
  // to open, so the only honest first screen is create-or-join. Waiting for
  // workspacesLoaded avoids flashing onboarding at a member mid-fetch.
  if (workspacesLoaded && workspaces.length === 0) {
    return <WorkspaceOnboarding onDone={fetchWorkspaces} />;
  }

  return (
    // h-dvh, not h-screen: 100vh overflows the visible viewport on phones
    // with a dynamic URL bar, pushing the composer under the pill nav.
    <div className="wasp-shell flex h-dvh w-screen overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)]">
      {/* ---------- App rail ---------- */}
      <nav
        aria-label="Primary"
        className="wasp-rail flex w-[68px] min-w-[68px] flex-col items-center gap-1 border-r border-[var(--border-color)] bg-[var(--bg-rail)] py-3"
      >
        <div className="mb-2 flex h-10 w-10 items-center justify-center" title="WASP">
          <WaspMark size={34} />
        </div>

        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const active =
            id === "messages" ? messagesActive : activeView === id && !activeWorkspace;
          return (
            <button
              key={id}
              onClick={() => handleNavClick(id)}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              title={id === "messages" ? "Personal messages" : label}
              className={[
                "group relative flex h-11 w-11 items-center justify-center rounded-xl",
                "cursor-pointer transition-colors",
                active
                  ? "bg-[var(--accent-muted)] text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]",
              ].join(" ")}
            >
              <Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.4 : 2} />

              {active && (
                <span className="absolute -left-3 h-5 w-1 rounded-r-full bg-[var(--accent)]" />
              )}

              {id === "notifications" && unreadNotifs > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-white">
                  {unreadNotifs > 9 ? "9+" : unreadNotifs}
                </span>
              )}
            </button>
          );
        })}

        {/* ---------- Workspaces ---------- */}
        <div className="my-2 h-px w-8 bg-[var(--border-color)]" />
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectPersonal={() => handleNavClick("messages")}
          onSelectWorkspace={handleWorkspaceClick}
          onAddWorkspace={() => setIsWorkspaceModalOpen(true)}
        />

        <div className="flex-1" />

        {/* ---------- Identity (drop-up: Profile · Settings · Log out) ---------- */}
        <div className="relative mt-2 flex flex-col items-center">
          <button
            onClick={() => setUserMenuOpen((o) => !o)}
            title={`${currentUser.displayName || currentUser.username}`}
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            className={[
              "cursor-pointer rounded-full ring-2 transition",
              userMenuOpen || activeView === "profile" || activeView === "settings"
                ? "ring-[var(--accent)]"
                : "ring-transparent hover:ring-[var(--accent-ring)]",
            ].join(" ")}
          >
            <img
              src={prettyAvatar(currentUser.avatarUrl, currentUser.username)}
              alt=""
              onError={(e) => handleAvatarError(e, currentUser.username)}
              className="h-9 w-9 rounded-full object-cover"
            />
          </button>

          {userMenuOpen && (
            <>
              {/* click-away layer */}
              <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
              <div
                role="menu"
                className="rail-popover absolute bottom-full left-full z-50 mb-0 ml-3 w-60 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
              >
                <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-3 py-3">
                  <img
                    src={prettyAvatar(currentUser.avatarUrl, currentUser.username)}
                    alt=""
                    onError={(e) => handleAvatarError(e, currentUser.username)}
                    className="h-9 w-9 rounded-full object-cover"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{currentUser.displayName || currentUser.username}</p>
                    <p className="truncate text-xs text-[var(--text-muted)]">@{currentUser.username}</p>
                  </div>
                </div>
                <div className="py-1">
                  <button role="menuitem" onClick={() => { setUserMenuOpen(false); handleNavClick("profile"); }} className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
                    <User className="h-4 w-4 text-[var(--text-muted)]" /> Profile
                  </button>
                  <button role="menuitem" onClick={() => { setUserMenuOpen(false); handleNavClick("settings"); }} className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
                    <Settings className="h-4 w-4 text-[var(--text-muted)]" /> Settings
                  </button>
                </div>
                <div className="border-t border-[var(--border-color)] py-1">
                  <p className="px-3 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Switch account</p>
                  {savedAccounts.filter((a) => a.id !== currentUser.id).map((a) => (
                    <div key={a.id} className="group flex items-center gap-2.5 px-3 py-1.5 hover:bg-[var(--bg-surface-hover)]">
                      <button
                        role="menuitem"
                        onClick={() => switchAccount(a)}
                        disabled={!!switching}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left disabled:opacity-60"
                      >
                        <img src={prettyAvatar(a.avatarUrl, a.username)} onError={(e) => handleAvatarError(e, a.username)} alt="" className="h-7 w-7 rounded-full object-cover" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-[var(--text-primary)]">{a.displayName || a.username}</span>
                          <span className="block truncate text-[11px] text-[var(--text-muted)]">@{a.username}</span>
                        </span>
                        {switching === a.id && <Check className="ml-auto h-3.5 w-3.5 animate-pulse text-[var(--accent)]" />}
                      </button>
                      <button
                        onClick={() => { removeAccount(a.id); setSavedAccounts(getSavedAccounts()); }}
                        title="Forget this account on this device"
                        aria-label={`Remove @${a.username} from this device`}
                        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--text-muted)] opacity-0 hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    role="menuitem"
                    onClick={() => { setUserMenuOpen(false); window.location.assign("/login?add=1"); }}
                    className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-[var(--border-color-active)] text-[var(--text-muted)]"><Plus className="h-3.5 w-3.5" /></span>
                    Add another account
                  </button>
                </div>
                <div className="border-t border-[var(--border-color)] py-1">
                  <button role="menuitem" onClick={() => { setUserMenuOpen(false); removeAccount(currentUser.id); onLogout(); }} className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)]">
                    <LogOut className="h-4 w-4" /> Log out @{currentUser.username}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </nav>

      {/* ---------- Active view ---------- */}
      <div className="wasp-view flex min-w-0 flex-1 overflow-hidden">
        {/* Kept mounted, only hidden, when another view is active: unmounting it
            killed the realtime stream *and* any call in progress — the camera
            stayed on with no way to hang up. The call overlay itself is
            portalled to <body> so it stays visible over whatever view is up. */}
        {(!activeWorkspaceId || workspacesLoaded) && (
          <div className={activeView === "messages" ? "flex min-w-0 flex-1 overflow-hidden" : "hidden"}>
            <ChatWorkspace
              currentUser={currentUser}
              onLogout={onLogout}
              onUserUpdate={onUserUpdate}
              workspace={chatWorkspaceProp}
              onOpenWorkspaceInfo={() => setIsWorkspaceInfoOpen(true)}
            />
          </div>
        )}
        {activeView === "home" && (
          <HomeFeed currentUser={currentUser} defaultVisibility={currentUser.preferences?.defaultPostVisibility ?? "public"} />
        )}
        {activeView === "explore" && <ExplorePage currentUser={currentUser} />}
        {activeView === "notifications" && <NotificationsPage />}
        {activeView === "profile" && (
          <ProfilePage
            currentUser={currentUser}
            onLogout={onLogout}
            onUserUpdate={onUserUpdate}
          />
        )}
        {activeView === "user" && profileUsername && (
          profileUsername.toLowerCase() === currentUser.username.toLowerCase()
            ? <ProfilePage currentUser={currentUser} onLogout={onLogout} onUserUpdate={onUserUpdate} />
            : <UserProfilePage key={profileUsername} username={profileUsername} currentUser={currentUser} />
        )}
        {activeView === "settings" && (
          <SettingsPage
            currentUser={currentUser}
            onLogout={onLogout}
            onUserUpdate={onUserUpdate}
          />
        )}
      </div>

      <InstallPrompt />

      {isWorkspaceInfoOpen && activeWorkspace && (
        <WorkspaceInfoModal
          workspace={activeWorkspace}
          currentUserId={currentUser.id}
          onClose={() => setIsWorkspaceInfoOpen(false)}
          onUpdated={(ws) => setWorkspaces((prev) => prev.map((w) => (w.id === ws.id ? { ...w, ...ws } : w)))}
          onLeft={() => {
            setIsWorkspaceInfoOpen(false);
            setWorkspaces((prev) => prev.filter((w) => w.id !== activeWorkspace.id));
            navigate(VIEW_PATHS.messages);
          }}
        />
      )}

      {isWorkspaceModalOpen && (
        <WorkspaceModal
          onClose={() => setIsWorkspaceModalOpen(false)}
          onJoined={handleJoined}
        />
      )}
    </div>
  );
}
