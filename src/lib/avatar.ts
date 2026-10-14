import type { SyntheticEvent } from "react";

/**
 * Shared avatar helpers.
 *
 * These were previously duplicated in ChatWorkspace, the shell and the feed
 * screens; keeping one copy means a broken-image fix lands everywhere at once.
 */

/** Upgrades the dull default identicon to a nicer generated avatar. */
export function prettyAvatar(url?: string | null, seed?: string): string {
  if (!url || /dicebear\.com\/[^/]+\/identicon/.test(url)) {
    const s = encodeURIComponent(seed || "user");
    return `https://api.dicebear.com/7.x/glass/svg?seed=${s}&backgroundType=gradientLinear&backgroundColor=7c7cf0,6b8afd,5b8f8a,9a7bd0`;
  }
  return url;
}

/** Inline SVG monogram used when a remote avatar fails to load. */
export function avatarFallbackSvg(seed?: string): string {
  const name = seed || "?";
  const initial = name.charAt(0).toUpperCase();

  // Derive a stable hue from the seed so a given user always gets one colour.
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="hsl(${hue},55%,45%)"/>` +
    `<stop offset="100%" stop-color="hsl(${(hue + 40) % 360},60%,35%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="128" height="128" rx="64" fill="url(#g)"/>` +
    `<text x="64" y="64" dy=".35em" text-anchor="middle" fill="white" ` +
    `font-family="-apple-system,sans-serif" font-size="52" font-weight="600">${initial}</text>` +
    `</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** onError handler that swaps a broken avatar for the monogram fallback. */
export function handleAvatarError(
  e: SyntheticEvent<HTMLImageElement>,
  seed?: string
): void {
  const target = e.currentTarget;
  if (target.dataset.fallback === "true") return; // guard against loops
  target.dataset.fallback = "true";
  target.src = avatarFallbackSvg(seed);
}
