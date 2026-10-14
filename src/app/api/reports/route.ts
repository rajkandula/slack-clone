import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";

const REASONS = ["sexual", "harassment", "spam", "violence", "other"] as const;
const TARGETS = ["post", "comment", "user", "message"] as const;

/** Distinct reporters needed before a post is auto-hidden from feeds. */
const AUTO_HIDE_THRESHOLD = 3;

// POST /api/reports — { targetType, targetId, reason, details? }
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { targetType, targetId, reason, details } = await req.json();
  if (!TARGETS.includes(targetType) || typeof targetId !== "string" || !targetId || !REASONS.includes(reason)) {
    return NextResponse.json({ error: "targetType, targetId and reason are required" }, { status: 400 });
  }

  const db = await getDb();
  const reporterId = user._id!.toString();

  // Validate the target exists (post/comment) and forbid self-reports.
  if (targetType === "post") {
    if (!ObjectId.isValid(targetId)) return NextResponse.json({ error: "Invalid target" }, { status: 400 });
    const post = await db.collection("posts").findOne({ _id: new ObjectId(targetId) });
    if (!post || post.deletedAt) return NextResponse.json({ error: "Post not found" }, { status: 404 });
    if (post.authorId === reporterId) return NextResponse.json({ error: "You can't report your own post" }, { status: 400 });
  }
  if (targetType === "comment") {
    if (!ObjectId.isValid(targetId)) return NextResponse.json({ error: "Invalid target" }, { status: 400 });
    const comment = await db.collection("comments").findOne({ _id: new ObjectId(targetId) });
    if (!comment || comment.deletedAt) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  try {
    await db.collection("reports").insertOne({
      targetType,
      targetId,
      reporterId,
      reason,
      details: typeof details === "string" ? details.slice(0, 500) : null,
      createdAt: new Date(),
    });
  } catch (err: unknown) {
    // Unique index → the same person reporting the same thing twice is a no-op.
    if ((err as { code?: number }).code === 11000) {
      return NextResponse.json({ ok: true, alreadyReported: true });
    }
    throw err;
  }

  // Community auto-hide: enough independent reports pull a post from feeds
  // until it is reviewed. The author keeps seeing it (with the hidden state).
  let hidden = false;
  if (targetType === "post") {
    const count = await db.collection("reports").countDocuments({ targetType: "post", targetId });
    if (count >= AUTO_HIDE_THRESHOLD) {
      await db.collection("posts").updateOne({ _id: new ObjectId(targetId) }, { $set: { hiddenByReports: true } });
      hidden = true;
    }
  }

  return NextResponse.json({ ok: true, hidden });
}
