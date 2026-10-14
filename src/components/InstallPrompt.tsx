"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import WaspMark from "@/components/WaspMark";

/** Chrome's install event — not in the TS DOM lib yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const SNOOZE_KEY = "wasp-install-snooze";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // dismissed → quiet for two weeks

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function snoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    return at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * "Install WASP on this device" nudge, shown app-wide once signed in.
 * Chromium browsers get a real one-tap install via beforeinstallprompt;
 * iOS Safari can't offer a button, so it gets the Add-to-Home-Screen steps.
 * Never shows inside an installed app, and dismissing snoozes it two weeks.
 */
export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (isStandalone() || snoozed()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep Chrome's mini-infobar quiet; we render our own
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setShowIos(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // iOS never fires beforeinstallprompt — detect and show instructions instead.
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) setShowIos(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
    setHidden(true);
  };

  const install = async () => {
    if (!installEvent) return;
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === "accepted") setHidden(true);
      else dismiss();
    } catch {
      dismiss();
    }
    setInstallEvent(null);
  };

  if (hidden || (!installEvent && !showIos)) return null;

  return (
    <div className="install-prompt" role="dialog" aria-label="Install WASP">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0"><WaspMark size={30} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[var(--text-primary)]">Install WASP on this device</p>
          {installEvent ? (
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
              Get the app feel — its own window, faster launch, and call
              notifications that reach you even when the browser is closed.
            </p>
          ) : (
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
              Tap <Share className="inline h-3.5 w-3.5 align-[-2px]" aria-label="Share" /> in
              Safari, then <span className="font-semibold text-[var(--text-secondary)]">Add to Home Screen</span> —
              WASP becomes a real app on your phone.
            </p>
          )}
          {installEvent && (
            <button
              onClick={install}
              className="mt-2.5 flex cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-bold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-hover)]"
            >
              <Download className="h-3.5 w-3.5" /> Install
            </button>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 cursor-pointer rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
