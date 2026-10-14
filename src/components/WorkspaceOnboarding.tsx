"use client";

import { useState } from "react";
import { Building2, KeyRound, Users } from "lucide-react";

interface WorkspaceOnboardingProps {
  /** Fires once the user belongs to a workspace, so the shell can reload and move on. */
  onDone: () => void;
}

/**
 * The empty state for an account with no workspace.
 *
 * WASP is invite-only: until you share a workspace with someone, there is
 * nobody to see and nothing to read. Rather than show an empty app, we show
 * the only two honest ways forward — start a workspace, or redeem an invite.
 */
export default function WorkspaceOnboarding({ onDone }: WorkspaceOnboardingProps) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  // Errors are kept per path: a bad invite code should not put a red box on
  // the create card, which the user never touched.
  const [createError, setCreateError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  const createWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cleanName = name.trim();
    if (!cleanName) {
      setCreateError("Give your workspace a name.");
      return;
    }
    setBusy("create");
    setCreateError("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleanName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create the workspace");
      onDone();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create the workspace");
      setBusy(null);
    }
  };

  const joinWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cleanCode = code.trim();
    if (!cleanCode) {
      setJoinError("Paste the invite code you were sent.");
      return;
    }
    setBusy("join");
    setJoinError("");
    try {
      const res = await fetch("/api/workspaces/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: cleanCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "That invite code isn't valid");
      onDone();
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "That invite code isn't valid");
      setBusy(null);
    }
  };

  return (
    <div className="onboarding-wrapper">
      <style jsx>{`
        /* ---------------------------------------------------------------
           Workspace onboarding — the same restraint as the auth screen:
           one calm column, one accent, generous spacing, motion you feel
           rather than watch.
           --------------------------------------------------------------- */
        .onboarding-wrapper {
          position: relative;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 0;
          min-height: 100%; /* fills the shell's view slot, and a bare page too */
          overflow-y: auto;
          padding: 40px 20px calc(40px + env(safe-area-inset-bottom));
          background: var(--bg-app);
          font-family: var(--font-primary);
        }
        /* A single soft cobalt bloom — depth without decoration. */
        .onboarding-wrapper::before {
          content: "";
          position: absolute;
          top: -18%;
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

        .onboarding-inner {
          position: relative;
          width: 100%;
          max-width: 760px;
          margin: auto;
          animation: onboarding-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @keyframes onboarding-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: none; }
        }

        /* ---- masthead ---- */
        .onboarding-head {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          margin-bottom: 28px;
        }
        .head-badge {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 52px;
          height: 52px;
          margin-bottom: 16px;
          border-radius: 16px;
          color: var(--accent);
          background: var(--accent-muted);
          border: 1px solid var(--border-color);
        }
        .onboarding-head h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--text-primary);
        }
        .onboarding-head p {
          margin: 8px 0 0;
          max-width: 46ch;
          font-size: 14px;
          line-height: 1.55;
          color: var(--text-muted);
        }

        /* ---- the two paths ---- */
        .onboarding-paths {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
          align-items: start;
        }

        .path-card {
          display: flex;
          flex-direction: column;
          padding: 26px 24px 24px;
          border-radius: 22px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-color);
          box-shadow:
            0 1px 2px rgba(0, 0, 0, 0.04),
            0 12px 40px -12px rgba(15, 23, 42, 0.16);
        }

        .path-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          margin-bottom: 14px;
          border-radius: 12px;
          color: var(--accent);
          background: var(--accent-muted);
        }
        .path-title {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--text-primary);
        }
        .path-blurb {
          margin: 6px 0 20px;
          font-size: 13px;
          line-height: 1.5;
          color: var(--text-muted);
        }

        /* ---- fields ---- */
        .form-group { margin-bottom: 4px; }
        .form-label {
          display: block;
          margin-bottom: 7px;
          font-size: 13px;
          font-weight: 600;
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
        .form-input:hover:not(:focus):not(:disabled) { border-color: var(--border-color-active); }
        .form-input:focus {
          background: var(--bg-elevated);
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-ring, rgba(37, 99, 235, 0.18));
        }
        .form-input:disabled { opacity: 0.6; cursor: default; }
        .invite-input {
          letter-spacing: 0.12em;
          text-transform: uppercase;
          font-variant-numeric: tabular-nums;
        }
        .invite-input::placeholder { letter-spacing: 0.12em; }

        /* ---- primary action ---- */
        .submit-btn {
          width: 100%;
          height: 48px;
          margin-top: 18px;
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

        .submit-btn.secondary {
          color: var(--text-primary);
          background: var(--bg-surface);
          border: 1px solid var(--border-color);
        }
        .submit-btn.secondary:hover:not(:disabled) {
          background: var(--bg-surface-hover);
          border-color: var(--border-color-active);
          box-shadow: none;
        }

        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255, 255, 255, 0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        .submit-btn.secondary .spinner {
          border-color: var(--layer-3);
          border-top-color: var(--text-primary);
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ---- feedback ---- */
        .error-message {
          margin-top: 14px;
          padding: 11px 13px;
          font-size: 13px;
          line-height: 1.45;
          color: var(--danger);
          background: var(--danger-soft);
          border: 1px solid var(--danger-border);
          border-radius: 11px;
          animation: msg-in 0.22s ease-out both;
        }
        @keyframes msg-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: none; }
        }

        .onboarding-foot {
          margin: 24px 0 0;
          text-align: center;
          font-size: 13px;
          line-height: 1.55;
          color: var(--text-muted);
        }

        @media (max-width: 720px) {
          .onboarding-paths { grid-template-columns: 1fr; gap: 14px; }
          .onboarding-wrapper { padding: 28px 16px calc(28px + env(safe-area-inset-bottom)); }
          .path-card { padding: 22px 20px 20px; border-radius: 20px; }
          .onboarding-head h1 { font-size: 22px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .onboarding-inner,
          .error-message { animation: none; }
          .form-input,
          .submit-btn { transition: none; }
          .spinner { animation-duration: 1.6s; }
        }
      `}</style>

      <div className="onboarding-inner">
        <div className="onboarding-head">
          <div className="head-badge">
            <Users className="w-6 h-6" />
          </div>
          <h1>Set up your workspace</h1>
          <p>
            WASP is invite-only. You&apos;ll see and message the people you share a workspace
            with — start one for your team, or join the one you were invited to.
          </p>
        </div>

        <div className="onboarding-paths">
          {/* ---- Path A: start a workspace ---- */}
          <form className="path-card" onSubmit={createWorkspace}>
            <div className="path-icon">
              <Building2 className="w-5 h-5" />
            </div>
            <h2 className="path-title">Create a workspace</h2>
            <p className="path-blurb">
              For your company or team. You&apos;ll get an invite code to share with
              the people who belong in it.
            </p>

            <div className="form-group">
              <label className="form-label" htmlFor="workspace-name">
                Workspace name
              </label>
              <input
                id="workspace-name"
                type="text"
                placeholder="e.g. Acme Inc."
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (createError) setCreateError("");
                }}
                className="form-input"
                disabled={busy !== null}
                maxLength={60}
                autoComplete="organization"
              />
            </div>

            {createError && (
              <div className="error-message" role="alert">
                {createError}
              </div>
            )}

            <button type="submit" className="submit-btn" disabled={busy !== null}>
              {busy === "create" ? <div className="spinner" /> : "Create workspace"}
            </button>
          </form>

          {/* ---- Path B: redeem an invite ---- */}
          <form className="path-card" onSubmit={joinWorkspace}>
            <div className="path-icon">
              <KeyRound className="w-5 h-5" />
            </div>
            <h2 className="path-title">Join with an invite</h2>
            <p className="path-blurb">
              Already have a code from a teammate? Redeem it here and you&apos;ll land
              in their channels straight away.
            </p>

            <div className="form-group">
              <label className="form-label" htmlFor="invite-code">
                Invite code
              </label>
              <input
                id="invite-code"
                type="text"
                placeholder="ABC123"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (joinError) setJoinError("");
                }}
                className="form-input invite-input"
                disabled={busy !== null}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </div>

            {joinError && (
              <div className="error-message" role="alert">
                {joinError}
              </div>
            )}

            <button type="submit" className="submit-btn secondary" disabled={busy !== null}>
              {busy === "join" ? <div className="spinner" /> : "Join workspace"}
            </button>
          </form>
        </div>

        <p className="onboarding-foot">
          Not sure which workspace is yours? Ask a teammate to send you an invite code.
        </p>
      </div>
    </div>
  );
}
