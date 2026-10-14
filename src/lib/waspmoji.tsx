import React from "react";

/**
 * Waspmoji — WASP's own emoji set. Sixteen hand-drawn SVG expressions of the
 * wasp mascot, written as :shortcodes: in message text and reaction values,
 * rendered as inline images. They exist nowhere else, which is the point.
 */

export const WASPMOJI = [
  "buzz", "love", "lol", "sting", "fire", "cool", "party", "wow",
  "clap", "hi", "hundred", "rocket", "king", "think", "sleep", "sad", "angry",
] as const;

const NAMES = new Set<string>(WASPMOJI);

export const waspmojiUrl = (name: string) => `/waspmoji/${name}.svg`;

export const isWaspmoji = (value: string): boolean => {
  const m = /^:([a-z]+):$/.exec(value);
  return !!m && NAMES.has(m[1]);
};

const TOKEN = /(:[a-z]+:)/g;

/** Does this draft contain at least one valid Waspmoji shortcode? */
export function hasWaspmoji(text: string): boolean {
  const m = text.match(TOKEN);
  return !!m && m.some((t) => isWaspmoji(t));
}

/**
 * A message that is nothing but 1-3 Waspmoji (or unicode emoji) gets rendered
 * jumbo, the way every serious messenger treats an emoji-only message.
 * Returns 0 when the text has anything else in it.
 */
export function pureEmojiCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  // Waspmoji-only?
  const tokens = trimmed.split(/\s+/);
  if (tokens.every((t) => isWaspmoji(t))) return tokens.length <= 3 ? tokens.length : 0;
  // Unicode-emoji-only?
  try {
    const stripped = trimmed.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\s]/gu, "");
    if (stripped === "") {
      const count = [...new Intl.Segmenter().segment(trimmed)].filter((s2) => s2.segment.trim()).length;
      return count <= 3 ? count : 0;
    }
  } catch { /* older runtime */ }
  return 0;
}

/**
 * Render text with :shortcodes: swapped for inline Waspmoji images.
 * Unknown shortcodes pass through untouched, so ":something:" in normal prose
 * is safe.
 */
export function renderWaspmoji(text: string, size = 20): React.ReactNode {
  if (!text.includes(":")) return text;
  const parts = text.split(TOKEN);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    const m = /^:([a-z]+):$/.exec(part);
    if (m && NAMES.has(m[1])) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={waspmojiUrl(m[1])}
          alt={`:${m[1]}:`}
          title={`:${m[1]}:`}
          style={{ width: size, height: size, display: "inline-block", verticalAlign: "-4px", margin: "0 1px" }}
          draggable={false}
        />
      );
    }
    return part;
  });
}
