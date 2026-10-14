"use client";

import { useState, useEffect } from "react";
import { Search, Users, UserPlus, Lock } from "lucide-react";
import { handleAvatarError, prettyAvatar } from "@/lib/avatar";
import { navigate } from "@/lib/navigate";

interface ExploreUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  accountPrivate?: boolean;
  isFollowing?: boolean;
  requested?: boolean;
}

interface ExplorePageProps {
  currentUser: { id: string; username: string };
}


export default function ExplorePage({ currentUser }: ExplorePageProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [users, setUsers] = useState<ExploreUser[]>([]);
  const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);

  const searchUsers = async (query: string) => {
    setSearching(true);
    try {
      const res = await fetch(`/api/auth/search?q=${encodeURIComponent(query)}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        const list = data.users.filter((u: ExploreUser) => u.id !== currentUser.id);
        setUsers(list);
        // Seed follow state from the server so the buttons reflect reality
        // (previously it started empty, so everyone showed "Follow" after a reload).
        setFollowedIds((prev) => {
          const next = new Set(prev);
          for (const u of list as ExploreUser[]) {
            if (u.isFollowing) next.add(u.id);
            else next.delete(u.id);
          }
          return next;
        });
        setRequestedIds((prev) => {
          const next = new Set(prev);
          for (const u of list as ExploreUser[]) {
            if (u.requested) next.add(u.id);
            else next.delete(u.id);
          }
          return next;
        });
      }
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    // Empty query = everyone you share a workspace with. The search API is
    // scoped to co-members, so this list can legitimately come back empty.
    const t = setTimeout(() => searchUsers(""), 0);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    searchUsers(val);
  };

  const toggleFollow = async (userId: string) => {
    try {
      const res = await fetch("/api/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: userId }),
      });
      const data = await res.json();
      if (!res.ok) return;
      setFollowedIds((prev) => {
        const next = new Set(prev);
        if (data.following) next.add(userId); else next.delete(userId);
        return next;
      });
      setRequestedIds((prev) => {
        const next = new Set(prev);
        if (data.requested) next.add(userId); else next.delete(userId);
        return next;
      });
    } catch { /* ignore */ }
  };

  return (
    <div className="explore-layout">
      <style jsx>{`
  .explore-layout {
    flex: 1;
    overflow: hidden;
  }

  .explore-main {
    max-width: 640px;
    height: 100%;
    overflow-y: auto;
    margin: 0 auto;
    border-left: 1px solid var(--border-color);
    border-right: 1px solid var(--border-color);
    scrollbar-width: thin;
    scrollbar-color: var(--layer-3) transparent;
  }

  .explore-header {
    padding: 16px 20px;
    position: sticky;
    top: 0;
    background: var(--bg-header);
    backdrop-filter: blur(12px);
    z-index: 5;
    border-bottom: 1px solid var(--layer-2);
  }

  .explore-header h1 {
    font-size: 20px;
    font-weight: 800;
    margin: 0;
  }

  /* Says the quiet part out loud: this page is not the whole internet. */
  .explore-header p {
    margin: 4px 0 0;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .explore-search-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 16px 20px;
    padding: 10px 16px;
    background: var(--layer-2);
    border: 1px solid var(--layer-3);
    border-radius: 25px;
    color: var(--text-muted);
  }

  .explore-search-input {
    flex: 1;
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: 14px;
    outline: none;
    font-family: inherit;
  }

  .explore-search-input::placeholder {
    color: var(--text-muted);
  }

  .explore-section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    font-size: 13px;
    font-weight: 700;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--layer-1);
  }

  .explore-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    color: var(--text-muted);
    font-size: 14px;
  }

  /* ---- empty state ----------------------------------------------------
     An empty list here is usually correct, not broken: you only ever see
     people you share a workspace with. Say so instead of "No users found". */
  .explore-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 56px 28px 64px;
  }

  .explore-empty-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 46px;
    margin-bottom: 16px;
    border-radius: 14px;
    color: var(--accent);
    background: var(--accent-muted);
  }

  .explore-empty-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .explore-empty-body {
    margin: 8px 0 0;
    max-width: 38ch;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-muted);
  }

  .explore-users-grid {
    display: flex;
    flex-direction: column;
  }

  .explore-user-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--layer-1);
    transition: background 100ms;
  }

  .explore-user-card:hover {
    background: var(--layer-1);
  }

  .explore-user-avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .explore-user-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .explore-user-name {
    font-weight: 700;
    font-size: 14px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .explore-user-handle {
    font-size: 13px;
    color: var(--text-muted);
  }

  .explore-follow-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    background: var(--text-primary);
    color: var(--bg-app);
    border: none;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 100ms;
    flex-shrink: 0;
  }

  .explore-user-link {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .explore-lock {
    width: 12px;
    height: 12px;
    margin-left: 6px;
    vertical-align: -1px;
    color: var(--text-muted);
  }
  .explore-follow-btn.requested {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
  }
  .explore-follow-btn.requested:hover {
    border-color: var(--danger-border);
    color: var(--danger);
  }

  .explore-follow-btn:hover {
    background: var(--text-primary);
  }

  .explore-follow-btn.following {
    background: transparent;
    border: 1px solid var(--layer-4);
    color: var(--text-primary);
  }

  .explore-follow-btn.following:hover {
    border-color: #f43f5e;
    color: #f43f5e;
  }
`}</style>
      <div className="explore-main">
        <div className="explore-header">
          <h1>Explore</h1>
          <p>People you share a workspace with</p>
        </div>

        <div className="explore-search-bar">
          <Search className="w-4 h-4" />
          <input
            type="text"
            placeholder="Search your workspace..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="explore-search-input"
          />
        </div>

        <div className="explore-section-title">
          <Users className="w-4 h-4" />
          People in your workspace
        </div>

        {searching && users.length === 0 ? (
          <div className="explore-loading">Searching...</div>
        ) : users.length === 0 ? (
          <div className="explore-empty">
            <div className="explore-empty-badge">
              <Users className="w-5 h-5" />
            </div>
            {searchQuery ? (
              <>
                <p className="explore-empty-title">No match in your workspaces</p>
                <p className="explore-empty-body">
                  Nobody you share a workspace with matches &ldquo;{searchQuery}&rdquo;. Search
                  only covers your workspaces — everyone else stays private.
                </p>
              </>
            ) : (
              <>
                <p className="explore-empty-title">Nobody here yet</p>
                <p className="explore-empty-body">
                  You only see people you share a workspace with. Invite your teammates with
                  your workspace invite code, or join a workspace you were invited to.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="explore-users-grid">
            {users.map(user => (
              <div key={user.id} className="explore-user-card">
                <button type="button" className="explore-user-link" onClick={() => navigate(`/u/${user.username}`)} title={`View @${user.username}`}>
                  <img
                    src={prettyAvatar(user.avatarUrl, user.username)}
                    onError={(e) => handleAvatarError(e, user.username)}
                    alt=""
                    className="explore-user-avatar"
                  />
                  <div className="explore-user-info">
                    <span className="explore-user-name">
                      {user.displayName || user.username}
                      {user.accountPrivate && <Lock className="explore-lock" aria-label="Private account" />}
                    </span>
                    <span className="explore-user-handle">@{user.username}</span>
                  </div>
                </button>
                <button
                  className={`explore-follow-btn ${followedIds.has(user.id) ? "following" : requestedIds.has(user.id) ? "requested" : ""}`}
                  onClick={() => toggleFollow(user.id)}
                  title={requestedIds.has(user.id) ? "Cancel request" : undefined}
                >
                  {followedIds.has(user.id) ? "Following" : requestedIds.has(user.id) ? "Requested" : (
                    <>
                      <UserPlus className="w-3.5 h-3.5" />
                      Follow
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

