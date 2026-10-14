/**
 * WASP's sound identity — every tone the app makes, in one place.
 *
 * All sounds are synthesized with WebAudio (no assets to download, nothing to
 * cache-bust). They share one lazy AudioContext, and every entry point is
 * wrapped so autoplay policy or a missing AudioContext can never throw into
 * app code — worst case a sound simply doesn't play.
 *
 * The signature ringtone is a marimba-style motif in D major — a quick
 * "say hey!" pickup, a descending answer, then a rise to a ringing top note —
 * stamped with a faint low "wasp buzz" under the first beat. The message
 * pips reuse the same key and timbre so the whole app sounds like one thing.
 */

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!sharedCtx || sharedCtx.state === "closed") sharedCtx = new AudioContext();
    if (sharedCtx.state === "suspended") void sharedCtx.resume().catch(() => {});
    return sharedCtx;
  } catch {
    return null;
  }
}

/**
 * Marimba-ish pluck: sine fundamental + the instrument's characteristic 4×
 * partial, with a fast exponential decay. `vol` is peak gain (keep ≤ 0.2).
 */
function pluck(ctx: AudioContext, dest: AudioNode, freq: number, at: number, decay: number, vol: number) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, at);
  gain.gain.exponentialRampToValueAtTime(0.0004, at + decay);
  gain.connect(dest);

  const partials: Array<[number, number]> = [
    [1, 1],
    [4, 0.14], // the woody marimba overtone
  ];
  for (const [mult, level] of partials) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    const pg = ctx.createGain();
    pg.gain.value = level;
    osc.connect(pg);
    pg.connect(gain);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

/** The faint low "wasp buzz" that stamps the ringtone's first beat. */
function buzz(ctx: AudioContext, dest: AudioNode, at: number) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 73.42; // D2
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 320;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.05, at + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0004, at + 0.4);
  osc.connect(lp);
  lp.connect(gain);
  gain.connect(dest);
  osc.start(at);
  osc.stop(at + 0.45);
}

// D-major motif the whole identity is built on.
const A4 = 440;
const D5 = 587.33;
const FS5 = 739.99;
const A5 = 880;
const D6 = 1174.66;

/** One pass of the signature ringtone motif (~2.4s of sound). */
function ringtoneMotif(ctx: AudioContext, dest: AudioNode, t0: number) {
  buzz(ctx, dest, t0);
  // "say hey!" pickup
  pluck(ctx, dest, A4, t0 + 0.0, 0.5, 0.16);
  pluck(ctx, dest, D5, t0 + 0.15, 0.6, 0.18);
  // descending answer
  pluck(ctx, dest, FS5, t0 + 0.45, 0.5, 0.15);
  pluck(ctx, dest, D5, t0 + 0.6, 0.5, 0.14);
  pluck(ctx, dest, A4, t0 + 0.75, 0.55, 0.13);
  // the rise — ends ringing on the high A
  pluck(ctx, dest, A4, t0 + 1.05, 0.4, 0.12);
  pluck(ctx, dest, D5, t0 + 1.2, 0.45, 0.14);
  pluck(ctx, dest, A5, t0 + 1.35, 1.05, 0.17);
}

const RING_LOOP_S = 3.4;

/**
 * Call audio. `incoming` plays the signature WASP ringtone (with vibration on
 * devices that support it); `ringback` plays the standard 440+480Hz tone so
 * callers instantly understand "it's ringing on their end".
 * Returns a stop function; safe to call in any environment.
 */
export function startCallSound(kind: "incoming" | "ringback"): () => void {
  let interval: ReturnType<typeof setInterval> | null = null;
  let vibrate: ReturnType<typeof setInterval> | null = null;
  let master: GainNode | null = null;

  try {
    const ctx = getCtx();
    if (ctx) {
      master = ctx.createGain();
      master.connect(ctx.destination);
      if (kind === "incoming") {
        const play = () => {
          try { if (master) ringtoneMotif(ctx, master, ctx.currentTime + 0.03); } catch { /* noop */ }
        };
        play();
        interval = setInterval(play, RING_LOOP_S * 1000);
      } else {
        const play = () => {
          try {
            if (!master) return;
            const t0 = ctx.currentTime + 0.03;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.05, t0);
            gain.connect(master);
            for (const freq of [440, 480]) {
              const osc = ctx.createOscillator();
              osc.type = "sine";
              osc.frequency.value = freq;
              osc.connect(gain);
              osc.start(t0);
              osc.stop(t0 + 1.4);
            }
          } catch { /* noop */ }
        };
        play();
        interval = setInterval(play, 4000);
      }
    }
  } catch { /* no audio permitted — vibration below still works */ }

  if (kind === "incoming" && typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate([400, 250, 400]);
      vibrate = setInterval(() => navigator.vibrate([400, 250, 400]), 2200);
    } catch { /* not supported */ }
  }

  return () => {
    if (interval) clearInterval(interval);
    if (vibrate) { clearInterval(vibrate); try { navigator.vibrate(0); } catch { /* noop */ } }
    try { master?.disconnect(); } catch { /* noop */ }
    master = null;
  };
}

/** Soft upward pip when your own message goes out. */
export function playMessageSent(): void {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    pluck(ctx, ctx.destination, D6, ctx.currentTime + 0.01, 0.14, 0.05);
  } catch { /* noop */ }
}

let lastReceiveAt = 0;

/**
 * Two-note "heyo" when someone else's message lands. Throttled so a burst of
 * messages doesn't turn into a xylophone solo.
 */
export function playMessageReceived(): void {
  const now = Date.now();
  if (now - lastReceiveAt < 1500) return;
  lastReceiveAt = now;
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.01;
    pluck(ctx, ctx.destination, D5, t0, 0.22, 0.07);
    pluck(ctx, ctx.destination, A5, t0 + 0.11, 0.3, 0.08);
  } catch { /* noop */ }
}
