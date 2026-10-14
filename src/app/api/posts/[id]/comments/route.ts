import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { canViewPost } from "@/lib/post-access";
import { ModerationError, assertCleanText } from "@/lib/moderation";

function shape(c: Record<string, unknown>, author: Record<string, unknown> | undefined, me: string, postAuthorId: string) {
  const authorId = String(c.authorId);
  return {
    id: String(c._id),
    postId: String(c.postId),
    authorId,
    author: {
      username: (author?.username as string) || "unknown",
      displayName: (author?.displayName as string) || (author?.username as string) || "Unknown",
      avatarUrl: (author?.avatarUrl as string) || "",
    },
    text: c.text as string,
    createdAt: c.createdAt,
    editedAt: c.editedAt || null,
    isOwner: authorId === me,                      // may edit
    canDelete: authorId === me || postAuthorId === me, // author or post owner may delete
  };
}

// GET /api/posts/[id]/comments
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: postId } = await params;
  if (!ObjectId.isValid(postId)) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });

  const db = await getDb();
  const me = user._id!.toString();
  const post = await db.collection("posts").findOne({ _id: new ObjectId(postId) });
  if (!post || !(await canViewPost(db, post, me))) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const comments = await db.collection("comments")
    .find({ postId, deletedAt: { $exists: false } })
    .sort({ createdAt: 1 })
    .limit(200)
    .toArray();
  const authorIds = [...new Set(comments.map((c) => String(c.authorId)))];
  const authors = authorIds.length
    ? await db.collection("users").find({ _id: { $in: authorIds.map((i) => new ObjectId(i)) } }).toArray()
    : [];
  const byId = Object.fromEntries(authors.map((a) => [a._id.toString(), a]));

  return NextResponse.json({
    commentsEnabled: post.commentsEnabled !== false,
    isPostOwner: post.authorId === me,
    comments: comments.map((c) => shape(c as Record<string, unknown>, byId[String(c.authorId)], me, post.authorId)),
  });
}

// POST /api/posts/[id]/comments — { text }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: postId } = await params;
  if (!ObjectId.isValid(postId)) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });

  const { text } = await req.json();
  const clean = typeof text === "string" ? text.trim().slice(0, 500) : "";
  if (!clean) return NextResponse.json({ error: "Comment text is required" }, { status: 400 });
  try {
    assertCleanText(clean, "comment");
  } catch (err) {
    if (err instanceof ModerationError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const db = await getDb();
  const me = user._id!.toString();
  const post = await db.collection("posts").findOne({ _id: new ObjectId(postId) });
  if (!post || !(await canViewPost(db, post, me))) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  if (post.commentsEnabled === false) {
    return NextResponse.json({ error: "Comments are turned off for this post" }, { status: 403 });
  }

  const doc = { postId, authorId: me, text: clean, createdAt: new Date() };
  const result = await db.collection("comments").insertOne(doc);
  await db.collection("posts").updateOne({ _id: post._id }, { $inc: { replies: 1 } });

  if (post.authorId !== me) {
    await db.collection("notifications").insertOne({
      userId: post.authorId,
      type: "comment",
      fromUserId: me,
      postId,
      text: clean.slice(0, 120),
      read: false,
      createdAt: new Date(),
    });
  }

  return NextResponse.json(
    shape({ ...doc, _id: result.insertedId }, { username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl }, me, post.authorId)
  );
}
