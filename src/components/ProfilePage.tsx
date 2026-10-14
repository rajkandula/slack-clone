"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Calendar, Camera, Loader2, Settings } from "lucide-react";
import { handleAvatarError, prettyAvatar } from "@/lib/avatar";
import { navigate } from "@/lib/navigate";
import { FeedPost, PostCard } from "./PostCard";
import FollowListModal from "./FollowListModal";

interface ProfileUser {
  id: string;
  username: string;
  avatarUrl: string;
  status: string;
  displayName?: string | null;
  email?: string | null;
}

type Post = FeedPost;

interface ProfilePageProps {
  currentUser: ProfileUser;
  onLogout: () => void;
  onUserUpdate: (user: ProfileUser) => void;
}




export default function ProfilePage({ currentUser, onLogout, onUserUpdate }: ProfilePageProps) {
  const [bio, setBio] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [joinedAt, setJoinedAt] = useState<string | null>(null);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [posts, setPosts] = useState<Post[]>([]);
  const [postCount, setPostCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"posts" | "liked" | "bookmarked">("posts");
  const [followList, setFollowList] = useState<"followers" | "following" | null>(null);

  const fetchProfileData = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, followRes, postsRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch(`/api/follow?userId=${currentUser.id}`),
        fetch(tab === "posts" ? `/api/posts?filter=author:${currentUser.id}` : `/api/posts?filter=${tab}`),
      ]);

      if (meRes.ok) {
        const meData = await meRes.json();
        setBio(meData.user?.bio || "");
        setBannerUrl(meData.user?.bannerUrl || "");
        setJoinedAt(meData.user?.createdAt || null);
      }

      if (followRes.ok) {
        const followData = await followRes.json();
        setFollowerCount(followData.followers || 0);
        setFollowingCount(followData.following || 0);
      }

      if (postsRes.ok) {
        const postsData = await postsRes.json();
        setPosts(postsData);
        if (tab === "posts") setPostCount(postsData.length);
      }
    } catch (err) {
      console.error("Profile fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [currentUser.id, tab]);

  useEffect(() => {
    fetchProfileData();
  }, [fetchProfileData]);

  const changeBanner = async (file: File | null) => {
    if (!file) return;
    // HEIC/HEIF from iPhones often arrive with an empty or non-image MIME type,
    // so fall back to the extension rather than silently rejecting the file.
    const looksLikeImage =
      file.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif|avif)$/i.test(file.name);
    if (!looksLikeImage) {
      setBannerError("That file isn't an image.");
      return;
    }

    setBannerError(null);
    setBannerBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/media/upload", { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upData.error || `Upload failed (${up.status})`);

      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bannerUrl: upData.mediaUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Could not save banner (${res.status})`);
      if (!data.user?.bannerUrl) throw new Error("The server did not accept that image URL.");

      setBannerUrl(data.user.bannerUrl);
    } catch (err) {
      // Swallowing this was why a failed banner change looked like nothing
      // happening at all.
      setBannerError(err instanceof Error ? err.message : "Could not change the banner.");
    } finally {
      setBannerBusy(false);
    }
  };

  const toggleAction = async (postId: string, action: "like" | "repost" | "bookmark") => {
    setPosts(prev => prev.map(p => {
      if (p.id !== postId) return p;
      if (action === "like") return { ...p, liked: !p.liked, likes: p.liked ? p.likes - 1 : p.likes + 1 };
      if (action === "repost") return { ...p, reposted: !p.reposted, reposts: p.reposted ? p.reposts - 1 : p.reposts + 1 };
      return { ...p, bookmarked: !p.bookmarked };
    }));
    try {
      await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } catch { /* optimistic */ }
  };

  return (
    <div className="profile-layout">
      <style jsx>{`
  .profile-layout {
    flex: 1;
    overflow: hidden;
  }

  .profile-main {
    max-width: 640px;
    height: 100%;
    overflow-y: auto;
    margin: 0 auto;
    border-left: 1px solid var(--border-color);
    border-right: 1px solid var(--border-color);
    scrollbar-width: thin;
    scrollbar-color: var(--layer-3) transparent;
  }

  .profile-header-bar {
    padding: 12px 20px;
    position: sticky;
    top: 0;
    background: var(--bg-header);
    backdrop-filter: blur(12px);
    z-index: 5;
    border-bottom: 1px solid var(--layer-2);
  }

  .profile-header-bar h1 {
    font-size: 18px;
    font-weight: 800;
    margin: 0;
  }

  .profile-post-count {
    font-size: 12px;
    color: var(--text-muted);
  }

  .profile-banner {
    position: relative;
    height: 150px;
    background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 50%, #1e1b4b 100%);
    background-size: cover;
    background-position: center;
  }
  /* Anchored top-right, NOT bottom-right: .profile-avatar-row is pulled up over
     the bottom 44px of the banner and carries z-index 1, so anything down there
     is covered and its clicks are swallowed by the row. */
  .banner-edit-btn {
    position: absolute;
    right: 12px;
    top: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(6px);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    /* Always visible. A hover-reveal control is unreachable on touch devices,
       and here the pointer had to cross the overlapping avatar row to get to
       it — which ended :hover on the banner and faded it out again. */
    opacity: 0.9;
    transition: opacity 0.15s, background 0.15s;
  }
  .banner-edit-btn:hover { opacity: 1; background: rgba(0, 0, 0, 0.72); }
  .banner-edit-btn:focus-visible { opacity: 1; outline: 2px solid var(--accent); outline-offset: 2px; }
  .banner-edit-btn:disabled { opacity: 1; cursor: default; }

  /* Dark scrim + white text rather than a --danger fill: in dark mode that
     token is a light red intended as foreground, and white on it fails
     contrast. A scrim also stays legible over an arbitrary banner image. */
  .banner-error {
    position: absolute;
    left: 12px;
    top: 12px;
    max-width: calc(100% - 175px);
    padding: 7px 12px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.62);
    backdrop-filter: blur(6px);
    border: 1px solid var(--danger);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
  }

  .profile-info-section {
    padding: 0 20px 16px;
  }

  .profile-avatar-row {
    position: relative;
    z-index: 1; /* stay above the (positioned) banner it overlaps */
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin-top: -44px;
    margin-bottom: 12px;
  }

  .profile-big-avatar {
    width: 88px;
    height: 88px;
    border-radius: 50%;
    border: 4px solid var(--bg-app);
    object-fit: cover;
  }

  .profile-logout-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: transparent;
    border: 1px solid var(--layer-4);
    border-radius: 20px;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 100ms;
  }

  .profile-logout-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .profile-display-name {
    font-size: 20px;
    font-weight: 800;
    margin: 0 0 2px;
  }

  .profile-handle {
    font-size: 14px;
    color: var(--text-muted);
    margin: 0 0 8px;
  }

  .profile-bio {
    font-size: 14px;
    color: var(--text-primary);
    margin: 0 0 10px;
    line-height: 1.5;
  }

  .profile-meta {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 12px;
  }

  .profile-meta span {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--text-muted);
  }

  .profile-stats {
    display: flex;
    gap: 20px;
  }

  .profile-stats span {
    font-size: 14px;
    color: var(--text-muted);
  }

  .profile-stats strong {
    color: var(--text-primary);
    font-weight: 700;
  }
  .profile-stat-btn {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 14px;
    color: var(--text-muted);
    cursor: pointer;
  }
  .profile-stat-btn:hover { text-decoration: underline; color: var(--text-primary); }

  .profile-tabs {
    display: flex;
    border-bottom: 1px solid var(--layer-2);
  }

  .profile-tab {
    flex: 1;
    padding: 14px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    position: relative;
    transition: color 100ms;
  }

  .profile-tab:hover { color: var(--text-primary); }

  .profile-tab.active {
    color: var(--text-primary);
  }

  .profile-tab.active::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 48px;
    height: 3px;
    background: var(--accent);
    border-radius: 3px;
  }

  .profile-loading, .profile-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    color: var(--text-muted);
    font-size: 14px;
  }

  .profile-posts {
    display: flex;
    flex-direction: column;
  }

  .profile-appearance {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 16px;
    padding: 12px 0 0;
    border-top: 1px solid var(--border-color);
  }
  .profile-appearance-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
  }
`}</style>
      <div className="profile-main">
        {/* Banner (click the camera to change) */}
        <div className="profile-banner" style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : undefined}>
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            style={{ display: "none" }}
            onChange={(e) => {
              changeBanner(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="banner-edit-btn"
            title="Change banner"
            disabled={bannerBusy}
            onClick={() => bannerInputRef.current?.click()}
          >
            {bannerBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
            <span>{bannerBusy ? "Uploading\u2026" : "Change banner"}</span>
          </button>
          {bannerError && <div className="banner-error" role="alert">{bannerError}</div>}
        </div>

        {/* Profile Info */}
        <div className="profile-info-section">
          <div className="profile-avatar-row">
            <img
              src={prettyAvatar(currentUser.avatarUrl, currentUser.username)}
              onError={(e) => handleAvatarError(e, currentUser.username)}
              alt=""
              className="profile-big-avatar"
            />
            <button className="profile-logout-btn" onClick={() => navigate("/settings")}>
              <Settings className="w-4 h-4" />
              Edit profile
            </button>
          </div>
          <h2 className="profile-display-name">{currentUser.displayName || currentUser.username}</h2>
          <p className="profile-handle">@{currentUser.username}</p>
          {bio && <p className="profile-bio">{bio}</p>}
          <div className="profile-meta">
            {/* Read from the account, not `new Date()` — that rendered today's month
                for everyone, so the profile always claimed you joined this month. */}
            {joinedAt && (
              <span><Calendar className="w-3.5 h-3.5" /> Joined {new Date(joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
            )}
          </div>
          <div className="profile-stats">
            <span><strong>{postCount}</strong> Post{postCount === 1 ? "" : "s"}</span>
            <button type="button" className="profile-stat-btn" onClick={() => setFollowList("following")}>
              <strong>{followingCount}</strong> Following
            </button>
            <button type="button" className="profile-stat-btn" onClick={() => setFollowList("followers")}>
              <strong>{followerCount}</strong> Followers
            </button>
          </div>

        </div>

        {/* Posts tab */}
        <div className="profile-tabs">
          <button className={`profile-tab ${tab === "posts" ? "active" : ""}`} onClick={() => setTab("posts")}>Posts</button>
          <button className={`profile-tab ${tab === "liked" ? "active" : ""}`} onClick={() => setTab("liked")}>Likes</button>
          <button className={`profile-tab ${tab === "bookmarked" ? "active" : ""}`} onClick={() => setTab("bookmarked")}>Saved</button>
        </div>

        {loading ? (
          <div className="profile-loading">Loading...</div>
        ) : posts.length === 0 ? (
          <div className="profile-empty">
            {tab === "posts" ? "No posts yet. Share your first thought!" : tab === "liked" ? "Posts you like will show up here." : "Save posts to find them here later."}
          </div>
        ) : (
          <div className="profile-posts">
            {posts.map(post => (
              <PostCard
                key={post.id}
                post={post}
                currentUser={currentUser}
                onToggle={toggleAction}
                onUpdated={(p) => setPosts((prev) => prev.map((x) => (x.id === p.id ? p : x)))}
                onDeleted={(id) => { setPosts((prev) => prev.filter((x) => x.id !== id)); setPostCount((c) => Math.max(0, c - 1)); }}
              />
            ))}
          </div>
        )}
      </div>

      {followList && (
        <FollowListModal
          userId={currentUser.id}
          type={followList}
          onClose={() => setFollowList(null)}
        />
      )}
    </div>
  );
}

