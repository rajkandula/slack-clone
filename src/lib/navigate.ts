/**
 * Client-side URL update without a Next navigation. pushState is integrated
 * with the Next router (usePathname re-renders) but does NOT remount the page,
 * so the chat list and the SSE connection survive view switches.
 */
export function navigate(path: string, { replace = false }: { replace?: boolean } = {}) {
  if (typeof window === "undefined") return;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === path) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
}
