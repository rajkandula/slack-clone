import { createHash } from "crypto";
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Db, ObjectId } from "mongodb";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { storageClient, isStorageConfigured, STORAGE_BUCKET_NAME, STORAGE_PUBLIC_BASE } from "./storage";
import { FORCE_TEXT_EXTENSIONS, classifyFile, extensionOf, PostMediaType } from "./post-media";
import { ModerationError, scanImage } from "./moderation";

/* =========================================================================
   Media pipeline
   -------------------------------------------------------------------------
   Every upload becomes ONE `media_assets` record keyed by the SHA-256 of its
   bytes. Re-uploading, forwarding or sharing the same file never stores a
   second copy — callers get the existing asset back.

   Images: EXIF-rotated, HEIC/HEIF → JPEG, plus a web-optimised WebP variant
   (≤ 2048px) and a 480px thumbnail. The untouched original is kept so
   "open full quality" is always possible.

   Video: original stored immediately; a poster is extracted; a background
   ffmpeg pass produces an H.264 720p/CRF-26 "optimised" rendition that the
   read APIs swap in once it exists (see resolveAssets). Without ffmpeg the
   original is simply served.
   ========================================================================= */

export interface MediaAssetDoc {
  _id?: ObjectId;
  hash: string; // sha256 hex of the original bytes
  type: PostMediaType;
  mime: string; // original mime
  size: number; // original bytes
  name: string; // first filename seen
  uploaderId: string;

  /** Canonical original (for HEIC this is the converted JPEG; see rawUrl). */
  originalUrl: string;
  /** The exact bytes uploaded, when they differ from originalUrl (HEIC). */
  rawUrl?: string | null;
  /** Web-optimised rendition to display by default (images: WebP; video: H.264). */
  optimizedUrl?: string | null;
  optimizedSize?: number | null;
  /** Small poster/thumbnail. */
  thumbUrl?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;

  /** Borderline NSFW — the UI blurs it behind a click-to-reveal overlay. */
  sensitive?: boolean;
  status: "ready" | "processing" | "failed";
  refCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredMedia {
  assetId: string;
  url: string; // what to display
  originalUrl: string;
  thumbUrl?: string;
  width?: number;
  height?: number;
  size: number;
  mime: string;
  name: string;
  type: PostMediaType;
  sensitive: boolean;
  deduplicated: boolean;
  optimizing: boolean;
}

const IMAGE_MAX_EDGE = 2048;
const IMAGE_WEBP_QUALITY = 82;
const THUMB_EDGE = 480;
const RASTER_EXTS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "avif", "tif", "tiff", "bmp", "gif"]);

/* ---- storage --------------------------------------------------------- */

async function store(key: string, body: Buffer, contentType: string): Promise<string> {
  if (isStorageConfigured && storageClient && STORAGE_BUCKET_NAME && STORAGE_PUBLIC_BASE) {
    await storageClient.send(
      new PutObjectCommand({ Bucket: STORAGE_BUCKET_NAME, Key: key, Body: body, ContentType: contentType })
    );
    return `${STORAGE_PUBLIC_BASE.replace(/\/$/, "")}/${key}`;
  }
  // Local disk is a development convenience only. In production every container
  // filesystem is ephemeral and per-instance, so falling back here would return
  // a /uploads/... URL that 404s the moment the instance restarts — silent data
  // loss discovered hours later. Fail loudly at the first upload instead.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Media storage is not configured: set STORAGE_BUCKET, " +
        "STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, " +
        "STORAGE_ENDPOINT and STORAGE_PUBLIC_URL."
    );
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, path.basename(key)), body);
  return `/uploads/${path.basename(key)}`;
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

/* ---- public entry ------------------------------------------------------ */

export async function ingestUpload(
  db: Db,
  input: { buffer: Buffer; name: string; mime: string },
  uploaderId: string
): Promise<StoredMedia> {
  const assets = db.collection<MediaAssetDoc>("media_assets");
  const hash = createHash("sha256").update(input.buffer).digest("hex");

  // 1. Dedupe: same bytes → same asset, no second copy.
  const existing = await assets.findOne({ hash });
  if (existing) {
    await assets.updateOne({ _id: existing._id }, { $inc: { refCount: 1 }, $set: { updatedAt: new Date() } });
    return toStored(existing, input.name, true);
  }

  const ext = extensionOf(input.name);
  const mime = input.mime || "application/octet-stream";
  const type = classifyFile(input.name, mime);
  const base = `uploads/${hash.slice(0, 16)}`;
  const now = new Date();

  const doc: MediaAssetDoc = {
    hash,
    type,
    mime,
    size: input.buffer.length,
    name: input.name,
    uploaderId,
    originalUrl: "",
    status: "ready",
    refCount: 1,
    createdAt: now,
    updatedAt: now,
  };

  if (type === "image" && RASTER_EXTS.has(ext) && ext !== "gif") {
    await processRasterImage(doc, input.buffer, base, safeName(input.name));
  } else if (type === "video") {
    doc.originalUrl = await store(`${base}-${safeName(input.name)}`, input.buffer, mime);
    await processVideo(db, doc, input.buffer, base); // poster now, transcode in background
  } else {
    // Everything else (svg, gif, audio, documents, code): store as-is. HTML/JS
    // are stored as text/plain so the public bucket never serves them as pages.
    const contentType = FORCE_TEXT_EXTENSIONS.has(ext) ? "text/plain; charset=utf-8" : mime;
    doc.originalUrl = await store(`${base}-${safeName(input.name)}`, input.buffer, contentType);
    if (type === "image") {
      // gif / svg: dimensions only, no re-encode (animation / vector preserved)
      try {
        const meta = await sharp(input.buffer, { animated: false }).metadata();
        doc.width = meta.width ?? null;
        doc.height = meta.height ?? null;
      } catch { /* non-fatal */ }
    }
  }

  const result = await assets.insertOne(doc);
  doc._id = result.insertedId;
  return toStored(doc, input.name, false);
}

function toStored(a: MediaAssetDoc, name: string, deduplicated: boolean): StoredMedia {
  return {
    assetId: a._id!.toString(),
    url: a.optimizedUrl || a.originalUrl,
    originalUrl: a.originalUrl,
    thumbUrl: a.thumbUrl || undefined,
    width: a.width || undefined,
    height: a.height || undefined,
    size: a.optimizedSize || a.size,
    mime: a.mime,
    name,
    type: a.type,
    sensitive: !!a.sensitive,
    deduplicated,
    optimizing: a.status === "processing",
  };
}

/* ---- images ------------------------------------------------------------ */

/**
 * Decode HEIC/HEIF to a JPEG buffer. sharp's libheif is tried first; tiled
 * images (every iPhone photo is a tile grid) can trip libheif's security
 * limits, so we fall back to the pure-JS decoder, which has no such limit.
 */
async function heifToJpeg(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer, { failOn: "none" }).rotate().jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  } catch {
    const convert = (await import("heic-convert")).default;
    const out = await convert({ buffer, format: "JPEG", quality: 0.92 });
    // heic-convert applies EXIF orientation itself; re-encode via sharp for mozjpeg + consistency.
    return await sharp(Buffer.from(out)).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  }
}

async function processRasterImage(doc: MediaAssetDoc, buffer: Buffer, base: string, name: string) {
  const ext = extensionOf(name);
  const isHeif = ext === "heic" || ext === "heif" || /heic|heif/.test(doc.mime);

  // Guardrail: explicit images never reach storage; borderline gets flagged.
  const scan = await scanImage(buffer);
  if (scan.blocked) {
    throw new ModerationError("This image appears to contain explicit content and can't be uploaded.");
  }
  doc.sensitive = scan.sensitive;

  // For HEIF, decode once up front and run the rest of the pipeline on the
  // JPEG so every later step uses the same (robust) decode path.
  let workBuffer = buffer;
  let heifJpeg: Buffer | null = null;
  if (isHeif) {
    heifJpeg = await heifToJpeg(buffer);
    workBuffer = heifJpeg;
  }

  const pipeline = sharp(workBuffer, { failOn: "none" }).rotate(); // honour EXIF orientation
  const meta = await pipeline.metadata();
  const width = meta.autoOrient?.width ?? meta.width ?? null;
  const height = meta.autoOrient?.height ?? meta.height ?? null;
  doc.width = width;
  doc.height = height;

  if (isHeif && heifJpeg) {
    // Browsers can't show HEIC. Keep the raw file for archival and make a
    // full-resolution, high-quality JPEG the canonical "original".
    doc.rawUrl = await store(`${base}-${name}`, buffer, doc.mime || "image/heic");
    doc.originalUrl = await store(`${base}-original.jpg`, heifJpeg, "image/jpeg");
    doc.mime = "image/jpeg";
  } else {
    doc.originalUrl = await store(`${base}-${name}`, buffer, doc.mime);
  }

  // Display rendition: ≤ 2048px WebP. Only adopt it if it is actually smaller.
  const display = await sharp(workBuffer, { failOn: "none" })
    .rotate()
    .resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: IMAGE_WEBP_QUALITY, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });
  if (display.data.length < buffer.length * 0.92 || isHeif) {
    doc.optimizedUrl = await store(`${base}-w${IMAGE_MAX_EDGE}.webp`, display.data, "image/webp");
    doc.optimizedSize = display.data.length;
  }

  // Thumbnail for lists / posters.
  const thumb = await sharp(workBuffer, { failOn: "none" })
    .rotate()
    .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78, effort: 4 })
    .toBuffer();
  doc.thumbUrl = await store(`${base}-thumb.webp`, thumb, "image/webp");
}

/* ---- video ------------------------------------------------------------- */

let ffmpegAvailable: boolean | null = null;
async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  ffmpegAvailable = await new Promise<boolean>((resolve) => {
    const p = spawn("ffmpeg", ["-version"]);
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
  return ffmpegAvailable;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString().slice(-2000)));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(err.split("\n").slice(-3).join(" ")))));
  });
}

async function processVideo(db: Db, doc: MediaAssetDoc, buffer: Buffer, base: string) {
  if (!(await hasFfmpeg())) return; // serve the original as-is

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "wasp-video-"));
  const input = path.join(tmp, "in");
  await fs.writeFile(input, buffer);

  // Poster (fast, synchronous): first clear frame at ~1s, 640px wide.
  try {
    const poster = path.join(tmp, "poster.jpg");
    await run("ffmpeg", ["-y", "-ss", "1", "-i", input, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", "-q:v", "4", poster]);
    const posterBuf = await fs.readFile(poster);
    const scan = await scanImage(posterBuf);
    if (scan.blocked) {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
      throw new ModerationError("This video appears to contain explicit content and can't be uploaded.");
    }
    doc.sensitive = scan.sensitive;
    doc.thumbUrl = await store(`${base}-poster.jpg`, posterBuf, "image/jpeg");
    const meta = await sharp(posterBuf).metadata();
    doc.width = meta.width ?? null;
    doc.height = meta.height ?? null;
  } catch (err) {
    if (err instanceof ModerationError) throw err;
    /* poster is otherwise best-effort */
  }

  // Optimised rendition in the background: the request returns now with the
  // original; read APIs swap in optimizedUrl when it lands (resolveAssets).
  doc.status = "processing";
  const hash = doc.hash;
  void (async () => {
    const assets = db.collection<MediaAssetDoc>("media_assets");
    try {
      const out = path.join(tmp, "out.mp4");
      await run("ffmpeg", [
        "-y", "-i", input,
        // Bounded on purpose. This runs inside the same container that is
        // serving every open SSE stream, so an unbounded x264 would both spike
        // RSS (per-thread frame buffers) and starve the event loop. Two threads
        // keeps a 1080p transcode comfortably inside a small instance.
        "-threads", "2",
        "-vf", "scale='min(1280,iw)':-2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2",
        "-movflags", "+faststart",
        out,
      ]);
      const outBuf = await fs.readFile(out);
      // Only adopt if it is meaningfully smaller than the original.
      if (outBuf.length < buffer.length * 0.9) {
        const url = await store(`${base}-720p.mp4`, outBuf, "video/mp4");
        await assets.updateOne({ hash }, { $set: { optimizedUrl: url, optimizedSize: outBuf.length, status: "ready", updatedAt: new Date() } });
      } else {
        await assets.updateOne({ hash }, { $set: { status: "ready", updatedAt: new Date() } });
      }
    } catch (err) {
      console.error("Video transcode failed:", err);
      await assets.updateOne({ hash }, { $set: { status: "failed", updatedAt: new Date() } });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  })();
}

/* ---- read-side resolution ---------------------------------------------- */

/**
 * Given display URLs stored on posts/messages, return the best current URL
 * for each (the optimised rendition if it has since been produced) plus the
 * original. Lets background transcodes "upgrade" already-shared media.
 */
export async function resolveAssets(
  db: Db,
  urls: string[]
): Promise<Map<string, { url: string; originalUrl: string; thumbUrl?: string; width?: number; height?: number; sensitive?: boolean }>> {
  const unique = [...new Set(urls.filter(Boolean))];
  const out = new Map<string, { url: string; originalUrl: string; thumbUrl?: string; width?: number; height?: number; sensitive?: boolean }>();
  if (unique.length === 0) return out;
  const docs = await db
    .collection<MediaAssetDoc>("media_assets")
    .find({ $or: [{ originalUrl: { $in: unique } }, { optimizedUrl: { $in: unique } }, { rawUrl: { $in: unique } }] })
    .toArray();
  for (const a of docs) {
    const resolved = {
      url: a.optimizedUrl || a.originalUrl,
      originalUrl: a.originalUrl,
      thumbUrl: a.thumbUrl || undefined,
      width: a.width || undefined,
      height: a.height || undefined,
      sensitive: !!a.sensitive,
    };
    for (const u of [a.originalUrl, a.optimizedUrl, a.rawUrl]) if (u) out.set(u, resolved);
  }
  return out;
}
