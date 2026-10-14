"use client";

import { useState, useEffect } from "react";
import { Heart, Repeat, UserPlus, MessageCircle, Bell, AtSign, UserCheck, Check, X } from "lucide-react";
import { navigate } from "@/lib/navigate";
import { handleAvatarError, prettyAvatar } from "@/lib/avatar";

interface NotifUser {
  id?: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

interface Notification {
  id: string;
  type: string;
  fromUser: NotifUser | null;
  postId: string | null;
  text: string | null;
  read: boolean;
  resolved?: "accept" | "decline" | null;
  createdAt: string;
}


function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TYPE_CONFIG: Record<string, { icon: any; color: string; text: string }> = {
  like: { icon: Heart, color: "#f43f5e", text: "liked your post" },
  repost: { icon: Repeat, color: "#22c55e", text: "reposted your post" },
  follow: { icon: UserPlus, color: "#3b82f6", text: "started following you" },
  follow_request: { icon: UserPlus, color: "#3b82f6", text: "wants to follow you" },
  follow_accepted: { icon: UserCheck, color: "#22c55e", text: "accepted your follow request" },
  comment: { icon: MessageCircle, color: "#f59e0b", text: "commented on your post" },
  mention: { icon: AtSign, color: "#8b5cf6", text: "mentioned you" },
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const respond = async (n: Notification, action: "accept" | "decline") => {
    if (!n.fromUser?.id || busyId) return;
    setBusyId(n.id);
    try {
      const res = await fetch("/api/follow/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requesterId: n.fromUser.id, action }),
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, resolved: action } : x)));
      }
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/notifications");
        if (res.ok) {
          const data = await res.json();
          setNotifications(data);
        }
      } catch (err) {
        console.error("Fetch notifications error:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="notif-layout">
      <style jsx>{`
  .notif-layout {
    flex: 1;
    overflow: hidden;
  }

  .notif-main {
    max-width: 640px;
    height: 100%;
    overflow-y: auto;
    margin: 0 auto;
    border-left: 1px solid var(--border-color);
    border-right: 1px solid var(--border-color);
    scrollbar-width: thin;
    scrollbar-color: var(--layer-3) transparent;
  }

  .notif-header {
    padding: 16px 20px;
    position: sticky;
    top: 0;
    background: var(--bg-header);
    backdrop-filter: blur(12px);
    z-index: 5;
    border-bottom: 1px solid var(--layer-2);
  }

  .notif-header h1 {
    font-size: 20px;
    font-weight: 800;
    margin: 0;
  }

  .notif-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    color: var(--text-muted);
    font-size: 14px;
  }

  .notif-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 20px;
    text-align: center;
  }

  .notif-empty p {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 4px;
  }

  .notif-empty span {
    font-size: 13px;
    color: var(--text-muted);
  }

  .notif-list {
    display: flex;
    flex-direction: column;
  }

  .notif-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--layer-1);
    transition: background 100ms;
  }

  .notif-item:hover {
    background: var(--layer-1);
  }

  .notif-item.unread {
    background: var(--accent-muted);
  }

  .notif-icon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--layer-2);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .notif-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .notif-content {
    flex: 1;
    min-width: 0;
  }

  .notif-content p {
    margin: 0;
    font-size: 14px;
    color: var(--text-primary);
    line-height: 1.4;
  }

  .notif-content strong {
    font-weight: 700;
  }

  .notif-name { cursor: pointer; }
  .notif-name:hover { text-decoration: underline; }
  .notif-quote { display: block; margin-top: 2px; font-size: 13px; color: var(--text-secondary); }
  .notif-actions { display: flex; gap: 8px; margin-top: 8px; }
  .notif-accept, .notif-decline {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; cursor: pointer;
    border: 1px solid var(--border-color); background: var(--bg-surface); color: var(--text-secondary);
  }
  .notif-accept { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); }
  .notif-accept:hover { background: var(--accent-hover); }
  .notif-decline:hover { border-color: var(--danger-border); color: var(--danger); }
  .notif-accept:disabled, .notif-decline:disabled { opacity: 0.6; cursor: default; }
  .notif-resolved { display: inline-block; margin-top: 6px; font-size: 12px; font-weight: 600; color: var(--text-muted); }
  .notif-time {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 2px;
    display: block;
  }
`}</style>
      <div className="notif-main">
        <div className="notif-header">
          <h1>Notifications</h1>
        </div>

        {loading ? (
          <div className="notif-loading">Loading notifications...</div>
        ) : notifications.length === 0 ? (
          <div className="notif-empty">
            <Bell className="w-10 h-10" style={{ color: "#3b82f6", marginBottom: "12px" }} />
            <p>No notifications yet</p>
            <span>When someone interacts with your posts, you&apos;ll see it here.</span>
          </div>
        ) : (
          <div className="notif-list">
            {notifications.map(notif => {
              const config = TYPE_CONFIG[notif.type] || TYPE_CONFIG.like;
              const IconComp = config.icon;
              return (
                <div key={notif.id} className={`notif-item ${!notif.read ? "unread" : ""}`}>
                  <div className="notif-icon" style={{ color: config.color }}>
                    <IconComp className="w-4 h-4" style={notif.type === "like" ? { fill: "currentColor" } : undefined} />
                  </div>
                  {notif.fromUser && (
                    <img
                      src={prettyAvatar(notif.fromUser.avatarUrl, notif.fromUser.username)}
                      onError={(e) => handleAvatarError(e, notif.fromUser?.username)}
                      alt=""
                      className="notif-avatar"
                    />
                  )}
                  <div className="notif-content">
                    <p>
                      <strong
                        className="notif-name"
                        onClick={() => notif.fromUser?.username && navigate(`/u/${notif.fromUser.username}`)}
                      >
                        {notif.fromUser?.displayName || "Someone"}
                      </strong>
                      {" "}{config.text}
                      {notif.type === "comment" && notif.text ? <span className="notif-quote">“{notif.text}”</span> : null}
                    </p>
                    {notif.type === "follow_request" && (
                      notif.resolved ? (
                        <span className="notif-resolved">{notif.resolved === "accept" ? "Accepted" : "Declined"}</span>
                      ) : (
                        <div className="notif-actions">
                          <button className="notif-accept" disabled={busyId === notif.id} onClick={() => respond(notif, "accept")}>
                            <Check className="w-3.5 h-3.5" /> Accept
                          </button>
                          <button className="notif-decline" disabled={busyId === notif.id} onClick={() => respond(notif, "decline")}>
                            <X className="w-3.5 h-3.5" /> Decline
                          </button>
                        </div>
                      )
                    )}
                    <span className="notif-time">{timeAgo(notif.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

