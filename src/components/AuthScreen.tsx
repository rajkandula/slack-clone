"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import WaspMark from "./WaspMark";

interface AuthScreenProps {
  mode: "login" | "signup";
  onAuthSuccess: (user: { id: string; username: string; avatarUrl: string; status: string }, token?: string) => void;
}

export default function AuthScreen({ mode, onAuthSuccess }: AuthScreenProps) {
  const router = useRouter();
  const isLogin = mode === "login";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // One toggle for both password fields: on signup you want to eyeball that
  // password and confirmation match, which only works if they reveal together.
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* Alternate ways in, all on the login side:
     "password"   — username + password (default)
     "email-code" — passwordless: emailed 6-digit code
     "forgot"     — emailed password-reset link                         */
  const [view, setView] = useState<"password" | "email-code" | "forgot">("password");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");

  const resetViewState = () => {
    setError("");
    setNotice("");
    setCodeSent(false);
    setCode("");
  };

  /** Step 1 — ask for a sign-in code. */
  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send the code");
      setCodeSent(true);
      setNotice(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code");
    } finally {
      setLoading(false);
    }
  };

  /** Step 2 — exchange the code for a session. */
  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That code isn't right");
      onAuthSuccess(data.user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code isn't right");
      setLoading(false);
    }
  };

  /** Email a password-reset link. */
  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not send the email");
      setCodeSent(true);
      setNotice(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the email");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !password) {
      setError("Please fill in all fields.");
      return;
    }

    if (!isLogin) {
      if (!displayName || !email || !confirmPassword) {
        setError("Please fill in all fields.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        setError("Please enter a valid email address.");
        return;
      }
    }

    setError("");
    setLoading(true);

    try {
      const endpoint = isLogin ? "/api/auth/login" : "/api/auth/signup";
      const body = isLogin 
        ? { username, password } 
        : { username, password, displayName, email };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Something went wrong. Please try again.");
      }

      onAuthSuccess(data.user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <style jsx>{`
        /* ---------------------------------------------------------------
           Auth — one calm column on a quiet ground. Premium here means
           restraint: generous spacing, one accent, honest focus states,
           and motion you feel rather than watch.
           --------------------------------------------------------------- */
        .auth-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100dvh;
          padding: 28px 20px calc(28px + env(safe-area-inset-bottom));
          background: var(--bg-app);
          font-family: var(--font-primary);
          overflow: hidden;
        }
        /* A single soft cobalt bloom — depth without decoration. */
        .auth-wrapper::before {
          content: "";
          position: absolute;
          top: -22%;
          left: 50%;
          width: min(880px, 130vw);
          aspect-ratio: 1;
          transform: translateX(-50%);
          background: radial-gradient(
            circle,
            rgba(37, 99, 235, 0.13) 0%,
            rgba(37, 99, 235, 0.05) 42%,
            transparent 70%
          );
          pointer-events: none;
        }

        .auth-card {
          position: relative;
          width: 100%;
          max-width: 400px;
          padding: 36px 32px 30px;
          border-radius: 22px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-color);
          box-shadow:
            0 1px 2px rgba(0, 0, 0, 0.04),
            0 12px 40px -12px rgba(15, 23, 42, 0.16);
          animation: card-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes card-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: none; }
        }

        /* ---- masthead ---- */
        .logo-section {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          margin-bottom: 26px;
        }
        .logo-circle {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 14px;
          filter: drop-shadow(0 8px 20px rgba(37, 99, 235, 0.28));
        }
        .app-name {
          margin: 0;
          font-size: 25px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--text-primary);
        }
        .app-subtitle {
          margin: 6px 0 0;
          font-size: 14px;
          line-height: 1.5;
          color: var(--text-muted);
        }

        /* ---- fields ---- */
        .form-group { margin-bottom: 16px; }
        .form-label {
          display: block;
          margin-bottom: 7px;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0;
          text-transform: none; /* SHOUTING LABELS read as a form, not a product */
          color: var(--text-secondary);
        }
        .form-input {
          width: 100%;
          height: 46px; /* comfortably past the 44px touch target */
          padding: 0 14px;
          font-size: 16px; /* 16px stops iOS zooming the page on focus */
          font-family: inherit;
          color: var(--text-primary);
          background: var(--bg-surface);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          outline: none;
          transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }
        .form-input::placeholder { color: var(--text-muted); opacity: 0.75; }
        .form-input:hover:not(:focus) { border-color: var(--border-color-active); }
        .form-input:focus {
          background: var(--bg-elevated);
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-ring, rgba(37, 99, 235, 0.18));
        }

        .password-wrap { position: relative; }
        .password-wrap .form-input { padding-right: 46px; }
        .pw-toggle {
          position: absolute;
          top: 50%;
          right: 6px;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border: none;
          border-radius: 9px;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          transition: color 0.18s ease, background 0.18s ease;
        }
        .pw-toggle:hover { color: var(--text-primary); background: var(--bg-surface-hover); }
        .pw-toggle:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }

        .code-input {
          text-align: center;
          font-size: 24px;
          font-weight: 700;
          letter-spacing: 0.4em;
          text-indent: 0.4em; /* keeps the tracked text optically centred */
          font-variant-numeric: tabular-nums;
        }

        /* ---- primary action ---- */
        .submit-btn {
          width: 100%;
          height: 48px;
          margin-top: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          font-size: 15px;
          font-weight: 700;
          font-family: inherit;
          color: var(--text-on-accent);
          background: var(--accent);
          border: none;
          border-radius: 12px;
          cursor: pointer;
          transition: background 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
        }
        .submit-btn:hover:not(:disabled) {
          background: var(--accent-hover);
          box-shadow: 0 6px 18px -6px rgba(37, 99, 235, 0.6);
        }
        .submit-btn:active:not(:disabled) { box-shadow: none; }
        .submit-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .submit-btn:disabled { opacity: 0.6; cursor: default; }

        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255, 255, 255, 0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ---- secondary paths ---- */
        .divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 22px 0 16px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
        }
        .divider::before,
        .divider::after {
          content: "";
          flex: 1;
          height: 1px;
          background: var(--border-color);
        }

        .alt-actions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .alt-link {
          padding: 4px 2px;
          font-size: 14px;
          font-weight: 600;
          font-family: inherit;
          color: var(--text-secondary);
          background: none;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: color 0.18s ease;
        }
        .alt-link:hover:not(:disabled) { color: var(--text-primary); }
        .alt-link.primary { color: var(--accent); }
        .alt-link.primary:hover:not(:disabled) { color: var(--accent-hover); }
        .alt-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .alt-link:disabled { opacity: 0.55; cursor: default; }

        .toggle-text {
          margin: 22px 0 0;
          padding-top: 18px;
          border-top: 1px solid var(--border-color);
          text-align: center;
          font-size: 14px;
          color: var(--text-muted);
        }
        .toggle-link {
          margin-left: 5px;
          font-size: 14px;
          font-weight: 700;
          font-family: inherit;
          color: var(--accent);
          background: none;
          border: none;
          cursor: pointer;
          transition: color 0.18s ease;
        }
        .toggle-link:hover { color: var(--accent-hover); }
        .toggle-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

        /* ---- feedback ---- */
        .error-message,
        .notice-message {
          display: flex;
          align-items: flex-start;
          margin-bottom: 16px;
          padding: 11px 13px;
          font-size: 13px;
          line-height: 1.45;
          border-radius: 11px;
          border: 1px solid;
          animation: msg-in 0.22s ease-out both;
        }
        .error-message {
          color: var(--danger);
          background: var(--danger-soft);
          border-color: var(--danger-border);
        }
        .notice-message {
          color: var(--accent);
          background: var(--accent-muted);
          border-color: rgba(37, 99, 235, 0.24);
        }
        @keyframes msg-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: none; }
        }

        @media (max-width: 420px) {
          .auth-card { padding: 30px 22px 26px; border-radius: 20px; }
          .app-name { font-size: 23px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .auth-card,
          .error-message,
          .notice-message { animation: none; }
          .form-input,
          .submit-btn,
          .alt-link,
          .toggle-link,
          .pw-toggle { transition: none; }
        }
      `}</style>

      {/* Glow Rings */}
      <div className="glow-circle glow-1" />
      <div className="glow-circle glow-2" />

      {/* Main Form Card */}
      <div className="auth-card glass-panel">
        <div className="logo-section">
          <div className="logo-circle">
            <WaspMark size={72} />
          </div>
          <h1 className="app-name">WASP</h1>
          <p className="app-subtitle">
            {!isLogin
              ? "Create your account — free, in a few seconds"
              : view === "email-code"
                ? codeSent ? "Enter the code we emailed you" : "We'll email you a one-time code"
                : view === "forgot"
                  ? codeSent ? "Check your inbox" : "We'll email you a reset link"
                  : "Welcome back — sign in to keep talking"}
          </p>
        </div>

        {error && <div className="error-message">{error}</div>}
        {notice && !error && <div className="notice-message">{notice}</div>}

        {isLogin && view === "email-code" && (
          <form onSubmit={codeSent ? verifyCode : requestCode}>
            <div className="form-group">
              <label className="form-label">Email address</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
                disabled={loading || codeSent}
                autoComplete="email"
                required
              />
            </div>

            {codeSent && (
              <div className="form-group">
                <label className="form-label">6-digit code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="form-input code-input"
                  disabled={loading}
                  autoComplete="one-time-code"
                  required
                />
              </div>
            )}

            <button type="submit" className="submit-btn" disabled={loading || (codeSent && code.length !== 6)}>
              {loading ? <div className="spinner" /> : codeSent ? "Sign In" : "Email me a code"}
            </button>

            <div className="alt-actions">
              {codeSent && (
                <button type="button" className="alt-link" disabled={loading} onClick={() => { setCodeSent(false); setCode(""); setNotice(""); setError(""); }}>
                  Use a different email
                </button>
              )}
              <button type="button" className="alt-link" disabled={loading} onClick={() => { setView("password"); resetViewState(); }}>
                Sign in with a password instead
              </button>
            </div>
          </form>
        )}

        {isLogin && view === "forgot" && (
          <form onSubmit={requestReset}>
            {!codeSent && (
              <div className="form-group">
                <label className="form-label">Email address</label>
                <input
                  type="email"
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input"
                  disabled={loading}
                  autoComplete="email"
                  required
                />
              </div>
            )}

            {!codeSent && (
              <button type="submit" className="submit-btn" disabled={loading}>
                {loading ? <div className="spinner" /> : "Email me a reset link"}
              </button>
            )}

            <div className="alt-actions">
              <button type="button" className="alt-link" disabled={loading} onClick={() => { setView("password"); resetViewState(); }}>
                Back to sign in
              </button>
            </div>
          </form>
        )}

        <form onSubmit={handleSubmit} style={isLogin && view !== "password" ? { display: "none" } : undefined}>
          {!isLogin && (
            <>
              <div className="form-group">
                <label className="form-label">Full name</label>
                <input
                  type="text"
                  placeholder="e.g. John Doe"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="form-input"
                  disabled={loading}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email address</label>
                <input
                  type="email"
                  placeholder="e.g. user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input"
                  disabled={loading}
                  autoComplete="email"
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label">{isLogin ? "Username or email" : "Username"}</label>
            <input
              type="text"
              placeholder={isLogin ? "cool_user or you@example.com" : "e.g. cool_user"}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="form-input"
              disabled={loading}
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="password-wrap">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="form-input"
                disabled={loading}
                autoComplete={isLogin ? "current-password" : "new-password"}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {!isLogin && (
            <div className="form-group">
              <label className="form-label">Confirm password</label>
              <div className="password-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="form-input"
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>
            </div>
          )}

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? <div className="spinner" /> : isLogin ? "Sign In" : "Register"}
          </button>

          {isLogin && (
            <>
              <div className="divider"><span>or</span></div>
              <div className="alt-actions">
                <button type="button" className="alt-link primary" disabled={loading} onClick={() => { setView("email-code"); resetViewState(); }}>
                  Email me a sign-in code
                </button>
                <button type="button" className="alt-link" disabled={loading} onClick={() => { setView("forgot"); resetViewState(); }}>
                  Forgot your password?
                </button>
              </div>
            </>
          )}
        </form>

        <p className="toggle-text" style={isLogin && view !== "password" ? { display: "none" } : undefined}>
          {isLogin ? "Don't have an account?" : "Already have an account?"}
          <button
            type="button"
            className="toggle-link"
            onClick={() => {
              router.push(isLogin ? "/signup" : "/login");
              setError("");
              setDisplayName("");
              setEmail("");
              setConfirmPassword("");
            }}
            disabled={loading}
          >
            {isLogin ? "Create Account" : "Sign In"}
          </button>
        </p>
      </div>
    </div>
  );
}
