"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "wasp-theme";
const THEME_EVENT = "wasp-theme-change";

interface ThemeContextValue {
  /** What the user picked — may be "system". */
  theme: Theme;
  /** What is actually on screen right now — never "system". */
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  /** Flips between light and dark, resolving "system" first. */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/* ---- External stores ---------------------------------------------------
   The persisted choice lives in localStorage and the OS preference in a
   media query — both are external to React, so useSyncExternalStore is the
   correct primitive: hydration-safe (server snapshot = "system"/"light")
   and no setState-in-effect. */

function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

function subscribeStoredTheme(cb: () => void) {
  window.addEventListener("storage", cb); // other tabs
  window.addEventListener(THEME_EVENT, cb); // this tab
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(THEME_EVENT, cb);
  };
}

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function readSystemTheme(): "light" | "dark" {
  return darkQuery().matches ? "dark" : "light";
}

function subscribeSystemTheme(cb: () => void) {
  const mq = darkQuery();
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeStoredTheme, readStoredTheme, () => "system" as Theme);
  const systemTheme = useSyncExternalStore(subscribeSystemTheme, readSystemTheme, () => "light" as const);

  const resolvedTheme = theme === "system" ? systemTheme : theme;

  // Reflect the choice onto <html> so the CSS tokens switch.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* non-fatal: theme just won't persist */
    }
    // `storage` events don't fire in the tab that wrote, so notify manually.
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
