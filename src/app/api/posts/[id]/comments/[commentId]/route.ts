import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";

type Params = { params: Promise<{ id: string; commentId: string }> };

async function load(postId: string, commentId: string) {
  if (!ObjectId.isValid(postId) || !ObjectId.isValid(commentId)) return null;
  const db = await getDb();
  const [post, comment] = await Promise.all([
    db.collection("posts").findOne({ _id: new ObjectId(postId) }),
    db.collection("comments").findOne({ _id: new ObjectId(commentId), postId }),
  ]);
  if (!post || !comment || comment.deletedAt) return null;
  return { db, post, comment };
}

// PATCH — edit own comment. { text }
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: postId, commentId } = await params;
  const ctx = await load(postId, commentId);
  if (!ctx) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  const me = user._id!.toString();
  if (ctx.comment.authorId !== me) {
    return NextResponse.json({ error: "You can only edit your own comments" }, { status: 403 });
  }
  const { text } = await req.json();
  const clean = typeof text === "string" ? text.trim().slice(0, 500) : "";
  if (!clean) return NextResponse.json({ error: "Comment text is required" }, { status: 400 });

  const editedAt = new Date();
  await ctx.db.collection("comments").updateOne({ _id: ctx.comment._id }, { $set: { text: clean, editedAt } });
  return NextResponse.json({ ok: true, text: clean, editedAt });
}

// DELETE — comment author OR post owner (moderation).
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: postId, commentId } = await params;
  const ctx = await load(postId, commentId);
  if (!ctx) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  const me = user._id!.toString();
  if (ctx.comment.authorId !== me && ctx.post.authorId !== me) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  await ctx.db.collection("comments").updateOne({ _id: ctx.comment._id }, { $set: { deletedAt: new Date(), deletedBy: me } });
  await ctx.db.collection("posts").updateOne({ _id: ctx.post._id, replies: { $gt: 0 } }, { $inc: { replies: -1 } });
  return NextResponse.json({ ok: true });
}
