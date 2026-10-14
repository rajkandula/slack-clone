"use client";

import { ArrowLeft } from "lucide-react";
import { navigate } from "@/lib/navigate";

/**
 * Top-left back control for sub-pages (Settings, user profiles…).
 * Uses browser history when we navigated here in-app, otherwise falls back
 * to the given route so a deep link still has somewhere sensible to go.
 */
export default function BackButton({ fallback = "/home", label = "Back" }: { fallback?: string; label?: string }) {
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1 && document.referrer !== "") {
      window.history.back();
    } else if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate(fallback);
    }
  };
  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
    >
      <ArrowLeft className="h-[18px] w-[18px]" />
    </button>
  );
}
