"use client";

import { useCallback, useEffect, useState } from "react";
import { Calendar, Loader2, Lock, MessageSquare, UserCheck, UserPlus } from "lucide-react";
import { handleAvatarError, prettyAvatar } from "@/lib/avatar";
import { navigate } from "@/lib/navigate";
import BackButton from "./BackButton";
import { FeedPost, PostCard } from "./PostCard";
import FollowListModal from "./FollowListModal";

interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  bannerUrl?: string;
  bio: string;
  accountPrivate: boolean;
  createdAt: string;
  followers: number;
  following: number;
  postCount: number;
}
interface Relationship {
  isSelf: boolean;
  isFollowing: boolean;
  requested: boolean;
  canViewContent: boolean;
}

/**
 * Another user's profile. Private accounts show only the header until the
 * viewer is an accepted follower; the follow button sends a request instead.
 */
export default function UserProfilePage({
  username,
  currentUser,
}: {
  username: string;
  currentUser: { id: string; username: string; avatarUrl: string };
}) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [rel, setRel] = useState<Relationship | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [followList, setFollowList] = useState<"followers" | "following" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/users?username=${encodeURIComponent(username)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "User not found");
      setUser(data.user);
      setRel(data.relationship);
      if (data.relationship.canViewContent) {
        const pr = await fetch(`/api/posts?filter=author:${data.user.id}`);
        if (pr.ok) setPosts(await pr.json());
      } else {
        setPosts([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "User not found");
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const toggleFollow = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: user.id }),
      });
      if (res.ok) await load(); // relationship + counts + content gate may all change
    } finally {
      setBusy(false);
    }
  };

  const toggleAction = async (postId: string, action: "like" | "repost" | "bookmark") => {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        if (action === "like") return { ...p, liked: !p.liked, likes: p.liked ? p.likes - 1 : p.likes + 1 };
        if (action === "repost") return { ...p, reposted: !p.reposted, reposts: p.reposted ? p.reposts - 1 : p.reposts + 1 };
        return { ...p, bookmarked: !p.bookmarked };
      })
    );
    try {
      await fetch(`/api/posts/${postId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    } catch { /* optimistic */ }
  };

  const startDm = async () => {
    if (!user) return;
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "dm", recipientUsername: user.username }),
    });
    if (res.ok) {
      const data = await res.json();
      navigate(`/messages?chatId=${data.chat.id}`);
    }
  };

  return (
    // Tinted page behind a contained card column: on wide screens the profile
    // reads as a designed page instead of a strip adrift in empty space.
    <div className="flex-1 overflow-hidden bg-[var(--bg-app)]">
      {/* bg-elevated vs bg-app contrasts in BOTH themes — bg-surface vs a tint
          was invisible in dark mode, which made the page read as an empty void. */}
      <div className="mx-auto h-full max-w-[760px] overflow-y-auto bg-[var(--bg-elevated)] shadow-[0_0_50px_rgba(0,0,0,0.25)] ring-1 ring-[var(--border-color-active)]">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--border-color)] bg-[var(--bg-header)] px-4 py-2.5 backdrop-blur">
          <BackButton fallback="/explore" />
          <div className="min-w-0">
            <h1 className="truncate text-[17px] font-extrabold text-[var(--text-primary)]">{user?.displayName || `@${username}`}</h1>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" /></div>
        ) : error || !user || !rel ? (
          <p className="py-16 text-center text-sm text-[var(--text-muted)]">{error || "User not found"}</p>
        ) : (
          <>
            <div
              // no opacity here: opacity<1 promotes the banner to a later paint
              // phase, drawing it OVER the negative-margin avatar below it
              className="h-[180px] bg-[linear-gradient(135deg,var(--accent)_0%,var(--accent-hover)_60%,#1e1b4b_100%)] bg-cover bg-center"
              style={user.bannerUrl ? { backgroundImage: `url(${user.bannerUrl})` } : undefined}
            />
            <div className="px-5 pb-4">
              <div className="relative -mt-11 mb-3 flex items-end justify-between">
                <img
                  src={prettyAvatar(user.avatarUrl, user.username)}
                  onError={(e) => handleAvatarError(e, user.username)}
                  alt=""
                  className="h-[88px] w-[88px] rounded-full border-4 border-[var(--bg-elevated)] object-cover"
                />
                <div className="flex items-center gap-2 pb-1">
                  {rel.isSelf ? (
                    <button onClick={() => navigate("/settings")} className="cursor-pointer rounded-full border border-[var(--border-color)] px-4 py-1.5 text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)]">Edit profile</button>
                  ) : (
                    <>
                      {rel.isFollowing && (
                        <button onClick={startDm} title="Message" className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]">
                          <MessageSquare className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={toggleFollow}
                        disabled={busy}
                        className={[
                          "flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold transition-colors disabled:opacity-60",
                          rel.isFollowing
                            ? "border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--danger-border)] hover:text-[var(--danger)]"
                            : rel.requested
                              ? "border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--danger-border)] hover:text-[var(--danger)]"
                              : "bg-[var(--accent)] text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]",
                        ].join(" ")}
                      >
                        {rel.isFollowing ? <><UserCheck className="h-4 w-4" /> Following</> : rel.requested ? "Requested" : <><UserPlus className="h-4 w-4" /> Follow</>}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <h2 className="flex items-center gap-2 text-xl font-extrabold text-[var(--text-primary)]">
                {user.displayName}
                {user.accountPrivate && <Lock className="h-4 w-4 text-[var(--text-muted)]" aria-label="Private account" />}
              </h2>
              <p className="text-sm text-[var(--text-muted)]">@{user.username}</p>
              {user.bio && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">{user.bio}</p>}
              <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <Calendar className="h-3.5 w-3.5" /> Joined {new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </p>
              <div className="mt-3 flex gap-5 text-sm text-[var(--text-muted)]">
                <span><strong className="font-bold text-[var(--text-primary)]">{user.postCount}</strong> Post{user.postCount === 1 ? "" : "s"}</span>
                <button type="button" disabled={!rel.canViewContent} onClick={() => setFollowList("following")} className="cursor-pointer bg-transparent p-0 font-normal text-[var(--text-muted)] enabled:hover:text-[var(--text-primary)] enabled:hover:underline disabled:cursor-default">
                  <strong className="font-bold text-[var(--text-primary)]">{user.following}</strong> Following
                </button>
                <button type="button" disabled={!rel.canViewContent} onClick={() => setFollowList("followers")} className="cursor-pointer bg-transparent p-0 font-normal text-[var(--text-muted)] enabled:hover:text-[var(--text-primary)] enabled:hover:underline disabled:cursor-default">
                  <strong className="font-bold text-[var(--text-primary)]">{user.followers}</strong> Followers
                </button>
              </div>
            </div>

            <div className="border-t border-[var(--border-color)]">
              {!rel.canViewContent ? (
                <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]"><Lock className="h-5 w-5" /></span>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">This account is private</p>
                  <p className="max-w-xs text-xs text-[var(--text-muted)]">
                    {rel.requested ? "Your follow request is pending. Once accepted, you'll see their posts here." : "Follow to request access to their posts."}
                  </p>
                </div>
              ) : posts.length === 0 ? (
                <p className="py-14 text-center text-sm text-[var(--text-muted)]">No posts yet.</p>
              ) : (
                posts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    currentUser={currentUser}
                    onToggle={toggleAction}
                    onUpdated={(p) => setPosts((prev) => prev.map((x) => (x.id === p.id ? p : x)))}
                    onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>

      {followList && user && (
        <FollowListModal userId={user.id} type={followList} onClose={() => setFollowList(null)} />
      )}
    </div>
  );
}
