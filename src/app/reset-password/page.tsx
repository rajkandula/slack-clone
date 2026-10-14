"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2, Eye, EyeOff } from "lucide-react";
import WaspMark from "@/components/WaspMark";

/** Choose a new password from an emailed reset link. */
function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (password.length < 6) return setError("Password must be at least 6 characters");
    if (password !== confirm) return setError("Both passwords must match");

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not reset your password");
      setDone(true);
      setTimeout(() => router.replace("/login"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset your password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[var(--bg-app)] p-4">
      <div className="w-full max-w-[420px] rounded-3xl border border-[var(--border-color)] bg-[var(--bg-elevated)] p-8 shadow-[var(--shadow-lg)]">
        <div className="mb-7 flex flex-col items-center text-center">
          <WaspMark size={64} />
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-[var(--text-primary)]">
            {done ? "Password updated" : "Choose a new password"}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {done
              ? "Signing you back in shortly — use your new password."
              : token
                ? "Pick something you haven't used before."
                : "This link is missing its token."}
          </p>
        </div>

        {error && (
          <p className="mb-4 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}

        {done ? (
          <div className="flex flex-col items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-muted)] text-[var(--accent)]">
              <Check className="h-6 w-6" />
            </span>
            <button
              onClick={() => router.replace("/login")}
              className="cursor-pointer text-sm font-semibold text-[var(--accent)] hover:underline"
            >
              Go to sign in now
            </button>
          </div>
        ) : token ? (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                New password
              </span>
              <div className="relative flex">
                <input
                  type={showPassword ? "text" : "password"}
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={loading}
                  className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                Confirm password
              </span>
              <input
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                disabled={loading}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex h-11 cursor-pointer items-center justify-center rounded-xl bg-[var(--accent)] text-sm font-bold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update password"}
            </button>
          </form>
        ) : (
          <button
            onClick={() => router.replace("/login")}
            className="h-11 w-full cursor-pointer rounded-xl border border-[var(--border-color)] text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
