"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import WaspShell from "@/components/WaspShell";
import WaspMark from "@/components/WaspMark";

interface User {
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

export default function ShellClient() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          router.replace("/login");
        }
      } catch (err) {
        console.error("Session verification failed:", err);
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    }
    checkSession();
  }, [router]);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      router.replace("/login");
    } catch (err) {
      console.error("Logout failed:", err);
    }
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

  const handleUserUpdate = (updatedUser: User) => {
    setUser(updatedUser);
  };

  return user ? (
    <WaspShell currentUser={user} onLogout={handleLogout} onUserUpdate={handleUserUpdate} />
  ) : null;
}
