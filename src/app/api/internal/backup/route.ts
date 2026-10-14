import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { gzipSync } from "zlib";
import { EJSON } from "bson";
import { PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getDb } from "@/lib/mongodb";
import { jwtSecret } from "@/lib/secret";
import { storageClient, STORAGE_BUCKET_NAME } from "@/lib/storage";

/**
 * Nightly full dump of every collection to object storage. Call it once a day
 * from any scheduler: POST with the `x-backup-key` header (README → Backups).
 *
 * The Atlas free tier keeps no backups; this is the difference between "a bad
 * deploy corrupted the users collection" being a restore and being a funeral.
 * EJSON keeps ObjectIds/Dates restorable; gzip keeps it small. Backups live
 * under an HMAC-derived prefix so the bucket's public dev URL can't be walked
 * to find them.
 */

const KEEP_BACKUPS = 14;

function expectedKey(): string {
  return createHmac("sha256", jwtSecret()).update("wasp-backup-v1").digest("hex");
}

export async function POST(request: Request) {
  const provided = request.headers.get("x-backup-key") || "";
  const expected = expectedKey();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!storageClient || !STORAGE_BUCKET_NAME) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }

  try {
    const db = await getDb();
    const collections = (await db.listCollections().toArray()).map((c) => c.name);
    const dump: Record<string, unknown> = { _meta: { at: new Date().toISOString(), collections } };
    for (const name of collections) {
      dump[name] = await db.collection(name).find({}).toArray();
    }

    const body = gzipSync(Buffer.from(EJSON.stringify(dump)));
    const prefix = createHmac("sha256", jwtSecret()).update("wasp-backup-path").digest("hex").slice(0, 24);
    const key = `backups/${prefix}/wasp-${new Date().toISOString().slice(0, 10)}.ejson.gz`;

    await storageClient.send(
      new PutObjectCommand({ Bucket: STORAGE_BUCKET_NAME, Key: key, Body: body, ContentType: "application/gzip" })
    );

    // Rotate: keep the newest KEEP_BACKUPS.
    const listed = await storageClient.send(
      new ListObjectsV2Command({ Bucket: STORAGE_BUCKET_NAME, Prefix: `backups/${prefix}/` })
    );
    const objects = (listed.Contents || []).sort((x, y) => (x.Key! < y.Key! ? 1 : -1));
    for (const stale of objects.slice(KEEP_BACKUPS)) {
      await storageClient.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET_NAME, Key: stale.Key! }));
    }

    return NextResponse.json({ ok: true, key, bytes: body.length, collections: collections.length });
  } catch (err) {
    console.error("Backup failed:", err);
    return NextResponse.json({ error: "Backup failed" }, { status: 500 });
  }
}
