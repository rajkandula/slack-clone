import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { ingestUpload } from "@/lib/media-pipeline";
import { MAX_ATTACHMENT_BYTES, isBlockedFilename } from "@/lib/post-media";
import { ModerationError } from "@/lib/moderation";

/**
 * POST /api/media/upload (multipart, field "file")
 *
 * Runs the media pipeline: content-addressed dedupe, image optimisation
 * (EXIF rotate, HEIC→JPEG, WebP display + thumb), video poster + background
 * H.264 transcode. Returns the display URL plus original/thumb and dimensions.
 */
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (isBlockedFilename(file.name)) {
      return NextResponse.json({ error: "This file type is not allowed" }, { status: 415 });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: `File is too large (max ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB)` },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const db = await getDb();
    const stored = await ingestUpload(
      db,
      { buffer, name: file.name, mime: file.type || "application/octet-stream" },
      user._id.toString()
    );

    return NextResponse.json({
      success: true,
      // Back-compat fields used by existing callers:
      mediaUrl: stored.url,
      key: stored.assetId,
      name: stored.name,
      size: stored.size,
      mime: stored.mime,
      // New pipeline fields:
      assetId: stored.assetId,
      originalUrl: stored.originalUrl,
      thumbUrl: stored.thumbUrl,
      width: stored.width,
      height: stored.height,
      type: stored.type,
      sensitive: stored.sensitive,
      deduplicated: stored.deduplicated,
      optimizing: stored.optimizing,
    });
  } catch (error) {
    if (error instanceof ModerationError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Upload failed: " + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
