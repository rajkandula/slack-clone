import sharp from "sharp";
import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

/* =========================================================================
   Guardrails
   -------------------------------------------------------------------------
   Images: every uploaded raster image (and each video's poster frame) is
   scored by a self-hosted NSFW classifier (nsfwjs / MobileNetV2 running on
   pure-JS TensorFlow — no native deps, no external API):
     · clearly explicit (porn/hentai)      → upload REJECTED
     · borderline (softer nudity, "sexy")  → stored but marked `sensitive`,
       and the UI blurs it behind a click-to-reveal overlay.
   The model (~4 MB) is fetched once on first use and kept in memory. If it
   cannot load (offline), uploads proceed unscanned — availability over
   false rejection — and the failure is logged.

   Text: public surfaces (posts, comments) run through the `obscenity`
   matcher; matching content is rejected with a clear error. DMs are private
   speech and are NOT filtered — the report tool covers them.
   ========================================================================= */

export class ModerationError extends Error {
  status = 422 as const;
  constructor(message: string) {
    super(message);
    this.name = "ModerationError";
  }
}

/* ---- text ------------------------------------------------------------- */

const textMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

/** Throws ModerationError when public-facing text violates the guardrail. */
export function assertCleanText(text: string, surface: "post" | "comment"): void {
  if (!text) return;
  if (textMatcher.hasMatch(text)) {
    throw new ModerationError(
      surface === "post"
        ? "This post contains language that isn't allowed on public feeds. Please rephrase it."
        : "This comment contains language that isn't allowed. Please rephrase it."
    );
  }
}

/* ---- images ------------------------------------------------------------ */

export interface ImageScanResult {
  scanned: boolean;
  blocked: boolean;
  sensitive: boolean;
  scores?: Record<string, number>;
}

const BLOCK_EXPLICIT = 0.85; // porn + hentai
const SENSITIVE_EXPLICIT = 0.4;
const SENSITIVE_SEXY = 0.75;
const MODEL_INPUT = 224;

type NsfwModel = {
  classify: (t: unknown) => Promise<Array<{ className: string; probability: number }>>;
};

let modelPromise: Promise<NsfwModel | null> | null = null;

function loadModel(): Promise<NsfwModel | null> {
  if (!modelPromise) {
    modelPromise = (async () => {
      try {
        const tf = await import("@tensorflow/tfjs");
        await tf.ready();
        const nsfwjs = await import("nsfwjs");
        // Hosted quantised MobileNetV2 (default); cached in memory afterwards.
        const model = await nsfwjs.load();
        return model as unknown as NsfwModel;
      } catch (err) {
        console.error("NSFW model unavailable — image scanning disabled:", err);
        return null;
      }
    })();
  }
  return modelPromise;
}

/** Score an image. Never throws — a scanner outage must not break uploads. */
export async function scanImage(buffer: Buffer): Promise<ImageScanResult> {
  const model = await loadModel();
  if (!model) return { scanned: false, blocked: false, sensitive: false };

  try {
    const tf = await import("@tensorflow/tfjs");
    const { data, info } = await sharp(buffer, { failOn: "none" })
      .rotate()
      .removeAlpha()
      .resize(MODEL_INPUT, MODEL_INPUT, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const input = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], "int32");
    try {
      const predictions = await model.classify(input);
      const scores: Record<string, number> = {};
      for (const p of predictions) scores[p.className.toLowerCase()] = p.probability;

      const explicit = (scores.porn ?? 0) + (scores.hentai ?? 0);
      const blocked = explicit >= BLOCK_EXPLICIT;
      const sensitive = !blocked && (explicit >= SENSITIVE_EXPLICIT || (scores.sexy ?? 0) >= SENSITIVE_SEXY);
      return { scanned: true, blocked, sensitive, scores };
    } finally {
      input.dispose();
    }
  } catch (err) {
    console.error("Image scan failed (allowing upload unscanned):", err);
    return { scanned: false, blocked: false, sensitive: false };
  }
}
