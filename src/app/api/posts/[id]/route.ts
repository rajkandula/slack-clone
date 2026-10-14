import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { validateMedia } from "@/lib/post-media";
import { canViewPost } from "@/lib/post-access";

const VISIBILITIES = ["public", "followers", "private"] as const;

// PATCH /api/posts/[id]
//   { action: "like" | "repost" | "bookmark" }          → toggle interaction
//   { text?, media?, visibility? }  (author only)       → edit the post
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: postId } = await params;
  if (!ObjectId.isValid(postId)) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });
  const body = await req.json();
  const { action } = body;

  const db = await getDb();
  const userId = user._id!.toString();

  // ---- Edit path (no `action` supplied) ----------------------------------
  if (!action) {
    const post = await db.collection("posts").findOne({ _id: new ObjectId(postId) });
    if (!post || post.deletedAt) return NextResponse.json({ error: "Post not found" }, { status: 404 });
    if (post.authorId !== userId) return NextResponse.json({ error: "You can only edit your own posts" }, { status: 403 });

    const update: Record<string, unknown> = {};
    let contentChanged = false;

    if (typeof body.text === "string") {
      update.text = body.text.trim().substring(0, 1000);
      contentChanged = true;
    }
    if (body.media !== undefined) {
      const { media, error } = validateMedia(body.media);
      if (error) return NextResponse.json({ error }, { status: 400 });
      update.media = media;
      contentChanged = true;
    }
    if (body.visibility !== undefined) {
      if (!VISIBILITIES.includes(body.visibility)) {
        return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
      }
      update.visibility = body.visibility;
    }
    if (typeof body.commentsEnabled === "boolean") {
      update.commentsEnabled = body.commentsEnabled;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const finalText = (update.text as string | undefined) ?? post.text ?? "";
    const finalMedia = (update.media as unknown[] | undefined) ?? post.media ?? [];
    if (!finalText.trim() && finalMedia.length === 0 && !post.mediaUrl) {
      return NextResponse.json({ error: "A post needs text or an attachment" }, { status: 400 });
    }
    if (contentChanged) update.editedAt = new Date();

    await db.collection("posts").updateOne({ _id: post._id }, { $set: update });
    return NextResponse.json({
      ok: true,
      text: finalText,
      media: finalMedia,
      visibility: update.visibility ?? post.visibility ?? "public",
      commentsEnabled: (update.commentsEnabled as boolean | undefined) ?? post.commentsEnabled !== false,
      editedAt: (update.editedAt as Date | undefined) ?? post.editedAt ?? null,
    });
  }

  // ---- Interaction path --------------------------------------------------
  if (!["like", "repost", "bookmark"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // Liking/reposting reaches the author — it inserts a notification carrying
  // your identity — so it needs the same visibility gate as reading the post.
  // Without it, a stranger could ping anyone by liking any post id they held.
  const target = await db.collection("posts").findOne({ _id: new ObjectId(postId) });
  if (!target || !(await canViewPost(db, target, userId))) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  // Check if interaction exists
  const existing = await db.collection("post_interactions").findOne({
    postId,
    userId,
    type: action,
  });

  if (existing) {
    // Remove interaction
    await db.collection("post_interactions").deleteOne({ _id: existing._id });
    if (action !== "bookmark") {
      await db.collection("posts").updateOne(
        { _id: new ObjectId(postId) },
        { $inc: { [action === "like" ? "likes" : "reposts"]: -1 } }
      );
    }
    return NextResponse.json({ toggled: false });
  } else {
    // Add interaction
    await db.collection("post_interactions").insertOne({
      postId,
      userId,
      type: action,
      createdAt: new Date(),
    });
    if (action !== "bookmark") {
      await db.collection("posts").updateOne(
        { _id: new ObjectId(postId) },
        { $inc: { [action === "like" ? "likes" : "reposts"]: 1 } }
      );

      // Create notification for post author (if not self)
      const post = await db.collection("posts").findOne({
        _id: new ObjectId(postId),
      });
      if (post && post.authorId !== userId) {
        await db.collection("notifications").insertOne({
          userId: post.authorId,
          type: action,
          fromUserId: userId,
          postId,
          text: null,
          read: false,
          createdAt: new Date(),
        });
      }
    }
    return NextResponse.json({ toggled: true });
  }
}


// DELETE /api/posts/[id] — author only; soft delete so interactions/notifications keep referential integrity.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: postId } = await params;
  if (!ObjectId.isValid(postId)) return NextResponse.json({ error: "Invalid post id" }, { status: 400 });

  const db = await getDb();
  const userId = user._id!.toString();
  const post = await db.collection("posts").findOne({ _id: new ObjectId(postId) });
  if (!post || post.deletedAt) return NextResponse.json({ error: "Post not found" }, { status: 404 });
  if (post.authorId !== userId) return NextResponse.json({ error: "You can only delete your own posts" }, { status: 403 });

  await db.collection("posts").updateOne({ _id: post._id }, { $set: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
