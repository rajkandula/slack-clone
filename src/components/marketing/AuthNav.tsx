"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The one piece of the marketing pages that knows whether you're signed in.
 * Signed-out visitors get Sign in + Get started; signed-in users get a single
 * "Open WASP" — showing both was the bug this replaces.
 */
export default function AuthNav({ variant }: { variant: "header" | "hero" | "cta" | "footer" }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => setSignedIn(r.ok))
      .catch(() => setSignedIn(false));
  }, []);

  const primary =
    "cursor-pointer rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--text-on-accent)] transition-colors duration-200 hover:bg-[var(--accent-hover)]";
  const primaryBig =
    "cursor-pointer rounded-xl bg-[var(--accent)] px-7 py-3.5 text-base font-semibold text-[var(--text-on-accent)] transition-colors duration-200 hover:bg-[var(--accent-hover)]";
  const ghostBig =
    "cursor-pointer rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] px-7 py-3.5 text-base font-semibold text-[var(--text-primary)] transition-colors duration-200 hover:bg-[var(--bg-surface-hover)]";

  if (variant === "header") {
    return (
      <nav className="flex items-center gap-2">
        {signedIn ? (
          <Link href="/messages" className={primary}>Open WASP</Link>
        ) : (
          <>
            <Link
              href="/login"
              className="cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold text-[var(--text-secondary)] transition-colors duration-200 hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
            >
              Sign in
            </Link>
            <Link href="/signup" className={primary}>Get started</Link>
          </>
        )}
      </nav>
    );
  }

  if (variant === "hero") {
    return (
      <div className="flex flex-wrap items-center justify-center gap-3">
        {signedIn ? (
          <Link href="/messages" className={primaryBig}>Open WASP</Link>
        ) : (
          <>
            <Link href="/signup" className={primaryBig}>Get started — it&apos;s free</Link>
            <Link href="/login" className={ghostBig}>Sign in</Link>
          </>
        )}
      </div>
    );
  }

  if (variant === "cta") {
    return (
      <Link
        href={signedIn ? "/messages" : "/signup"}
        className="cursor-pointer inline-block rounded-xl bg-[var(--accent)] px-8 py-4 text-base font-semibold text-[var(--text-on-accent)] transition-colors duration-200 hover:bg-[var(--accent-hover)]"
      >
        {signedIn ? "Open WASP" : "Create your account"}
      </Link>
    );
  }

  // footer
  return signedIn ? (
    <Link href="/messages" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">Open WASP</Link>
  ) : (
    <span className="flex flex-col gap-2.5">
      <Link href="/login" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">Sign in</Link>
      <Link href="/signup" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">Create account</Link>
    </span>
  );
}
