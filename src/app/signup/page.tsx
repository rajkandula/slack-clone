"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthScreen from "@/components/AuthScreen";
import WaspMark from "@/components/WaspMark";
import { saveAccount } from "@/lib/accounts";

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkSession() {
      try {
        // ?add=1 → the user is adding another account; don't bounce them home.
        if (new URLSearchParams(window.location.search).get("add") === "1") {
          setLoading(false);
          return;
        }
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          router.replace("/");
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error("Session check failed:", err);
        setLoading(false);
      }
    }
    checkSession();
  }, [router]);

  const handleAuthSuccess = (user: { id: string; username: string; avatarUrl: string }, token?: string) => {
    saveAccount({ id: user.id, username: user.username, avatarUrl: user.avatarUrl, token });
    // Full navigation so every client state (chats, SSE, workspaces) starts fresh for this account.
    window.location.assign("/");
  };

  if (loading) {
    return (
      <div className="app-loader-container">
        <style jsx>{`
          .app-loader-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            width: 100vw;
            height: 100vh;
            background-color: var(--bg-app);
            color: var(--text-primary);
            font-family: var(--font-primary);
          }

          .pulse-logo {
            width: 80px;
            height: 80px;
            display: flex;
            align-items: center;
            justify-content: center;
            filter: drop-shadow(0 12px 28px var(--accent-ring));
            margin-bottom: 24px;
            animation: pulse-grow 1.8s infinite ease-in-out;
          }

          .loader-bar {
            width: 120px;
            height: 3px;
            background: rgba(255, 255, 255, 0.08);
            border-radius: 4px;
            overflow: hidden;
            position: relative;
          }

          .loader-progress {
            width: 60px;
            height: 100%;
            background: var(--accent);
            border-radius: 4px;
            position: absolute;
            animation: slide-progress 1.2s infinite ease-in-out;
          }

          @keyframes pulse-grow {
            0%, 100% {
              transform: scale(1);
              box-shadow: 0 12px 28px transparent;
            }
            50% {
              transform: scale(1.05);
              box-shadow: 0 16px 40px transparent;
            }
          }

          @keyframes slide-progress {
            0% { left: -60px; }
            100% { left: 120px; }
          }
        `}</style>
        
        <div className="pulse-logo">
          <WaspMark size={72} />
        </div>
        <div className="loader-bar">
          <div className="loader-progress" />
        </div>
      </div>
    );
  }

  return <AuthScreen mode="signup" onAuthSuccess={handleAuthSuccess} />;
}
