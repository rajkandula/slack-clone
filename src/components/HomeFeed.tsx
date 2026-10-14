"use client";

import { useState, useEffect, useCallback } from "react";
import { Send } from "lucide-react";
import { handleAvatarError, prettyAvatar } from "@/lib/avatar";
import type { PostMedia } from "@/lib/post-media";
import {
  AttachmentButtons,
  AttachmentPreviews,
  PendingAttachment,
} from "./PostMedia";
import { FeedPost, PostCard, PostVisibility, VisibilityPicker } from "./PostCard";

type Post = FeedPost;

interface HomeFeedProps {
  currentUser: { id: string; username: string; avatarUrl: string; displayName?: string | null };
  defaultVisibility?: PostVisibility;
}




export default function HomeFeed({ currentUser, defaultVisibility = "public" }: HomeFeedProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [compose, setCompose] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [composeError, setComposeError] = useState("");
  const [composeVisibility, setComposeVisibility] = useState<PostVisibility>(defaultVisibility);
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [feedFilter, setFeedFilter] = useState<"for-you" | "following">("for-you");

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/posts?feed=${feedFilter === "for-you" ? "all" : "following"}`);
      if (res.ok) {
        const data = await res.json();
        setPosts(data);
      }
    } catch (err) {
      console.error("Fetch posts error:", err);
    } finally {
      setLoading(false);
    }
  }, [feedFilter]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const uploadsPending = attachments.some((a) => a.uploading);
  const canPost = (compose.trim().length > 0 || attachments.length > 0) && !uploadsPending && !posting;

  const handlePost = async () => {
    const text = compose.trim();
    if (!canPost) return;
    setPosting(true);
    setComposeError("");
    try {
      const media: PostMedia[] = attachments.map(({ url, type, name, size, mime, originalUrl, thumbUrl, width, height }) => ({
        url, type, name, size, mime, originalUrl, thumbUrl, width, height,
      }));
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, media, visibility: composeVisibility }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not post");
      setPosts(prev => [data, ...prev]);
      setCompose("");
      setAttachments([]);
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : "Could not post");
    } finally {
      setPosting(false);
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
    <div className="feed-layout">
      <style jsx>{`
  .feed-layout {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .feed-main {
    flex: 1;
    max-width: 640px;
    margin: 0 auto;
    border-left: 1px solid var(--border-color);
    border-right: 1px solid var(--border-color);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--layer-3) transparent;
  }

  .feed-header {
    padding: 16px 20px;
    position: sticky;
    top: 0;
    background: var(--bg-header);
    backdrop-filter: blur(12px);
    z-index: 5;
    border-bottom: 1px solid var(--layer-2);
  }

  .feed-header h1 {
    font-size: 20px;
    font-weight: 800;
    margin: 0;
  }

  .feed-tabs {
    display: flex;
    border-bottom: 1px solid var(--layer-2);
  }

  .feed-tab {
    flex: 1;
    padding: 14px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: color 150ms;
    position: relative;
  }

  .feed-tab:hover { color: var(--text-primary); }

  .feed-tab.active {
    color: var(--text-primary);
  }

  .feed-tab.active::after {
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

  .compose-box {
    display: flex;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--layer-2);
  }

  .compose-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .compose-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .compose-input {
    width: 100%;
    min-height: 44px;
    max-height: 240px;
    padding: 8px 0;
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: 16px;
    resize: none;
    outline: none;
    font-family: inherit;
    line-height: 1.5;
    field-sizing: content; /* auto-grow in supporting browsers */
  }

  .compose-input::placeholder {
    color: var(--text-muted);
  }

  .compose-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    /* Attachment icons + visibility picker + Post must fit a 375px phone;
       wrapping beats clipping the Post button off-screen. */
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--layer-1);
  }

  .compose-tools {
    display: flex;
    gap: 4px;
  }

  .compose-tool-btn {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 6px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    transition: background 100ms;
  }

  .compose-tool-btn:hover {
    background: var(--accent-muted);
  }

  .compose-submit {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    background: var(--accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 100ms;
  }

  .compose-submit:hover { background: var(--accent-hover); }
  .compose-submit:disabled {
    background: var(--bg-surface);
    color: var(--text-muted);
    border: 1px solid var(--border-color);
    cursor: not-allowed;
  }
  .compose-submit:disabled:hover { background: var(--bg-surface); }
  .compose-error { font-size: 12px; color: var(--danger); margin: 0 0 6px; }

  .feed-loading, .feed-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    color: var(--text-muted);
    font-size: 15px;
  }

  .posts-list {
    display: flex;
    flex-direction: column;
  }


















`}</style>
      <div className="feed-main">
        <div className="feed-header">
          <h1>Home</h1>
        </div>

        <div className="feed-tabs">
          <button
            className={`feed-tab ${feedFilter === "for-you" ? "active" : ""}`}
            onClick={() => setFeedFilter("for-you")}
          >
            For you
          </button>
          <button
            className={`feed-tab ${feedFilter === "following" ? "active" : ""}`}
            onClick={() => setFeedFilter("following")}
          >
            Following
          </button>
        </div>

        {/* Compose */}
        <div className="compose-box">
          <img
            src={prettyAvatar(currentUser.avatarUrl, currentUser.username)}
            onError={(e) => handleAvatarError(e, currentUser.username)}
            alt=""
            className="compose-avatar"
          />
          <div className="compose-content">
            <textarea
              placeholder="What's on your mind?"
              value={compose}
              onChange={(e) => setCompose(e.target.value)}
              className="compose-input"
              rows={1}
            />
            <AttachmentPreviews
              attachments={attachments}
              onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.localId !== id))}
            />
            {composeError && <p className="compose-error">{composeError}</p>}
            <div className="compose-actions">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AttachmentButtons
                  attachments={attachments}
                  onChange={setAttachments}
                  onError={setComposeError}
                  disabled={posting}
                />
                <VisibilityPicker value={composeVisibility} onChange={setComposeVisibility} />
              </div>
              <button
                className="compose-submit"
                onClick={handlePost}
                disabled={!canPost}
              >
                <Send className="w-3.5 h-3.5" />
                {posting ? "Posting..." : "Post"}
              </button>
            </div>
          </div>
        </div>

        {/* Posts */}
        {loading ? (
          <div className="feed-loading">Loading posts...</div>
        ) : posts.length === 0 ? (
          <div className="feed-empty">
            <p>No posts yet. Be the first to share something!</p>
          </div>
        ) : (
          <div className="posts-list">
            {posts.map(post => (
              <PostCard
                key={post.id}
                post={post}
                currentUser={currentUser}
                onToggle={toggleAction}
                onUpdated={(p) => setPosts((prev) => prev.map((x) => (x.id === p.id ? p : x)))}
                onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

