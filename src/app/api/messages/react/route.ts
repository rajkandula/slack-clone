import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { ChatDoc, MessageDoc } from "@/lib/db-types";
import { ObjectId } from "mongodb";
import { formatMessage } from "../route";

// POST /api/messages/react - Toggle an emoji reaction on a message.
// Body: { messageId, emoji }
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { messageId, emoji } = await request.json();
    if (!messageId || !emoji || typeof emoji !== "string") {
      return NextResponse.json({ error: "messageId and emoji are required" }, { status: 400 });
    }

    const currentUserId = user._id.toString();
    const db = await getDb();

    const message = await db.collection<MessageDoc>("messages").findOne({ _id: new ObjectId(messageId) });
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    if (message.deletedAt) {
      return NextResponse.json({ error: "Cannot react to a deleted message" }, { status: 400 });
    }

    // Verify the reacting user belongs to the chat.
    const chat = await db.collection<ChatDoc>("chats").findOne({
      _id: new ObjectId(message.chatId),
      participants: currentUserId,
    });
    if (!chat) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Toggle: a user holds at most one of each emoji. Re-clicking the same emoji removes it.
    const reactions = (message.reactions || []).map((r) => ({ ...r, userIds: [...r.userIds] }));
    const existing = reactions.find((r) => r.emoji === emoji);

    if (existing) {
      if (existing.userIds.includes(currentUserId)) {
        existing.userIds = existing.userIds.filter((id) => id !== currentUserId);
      } else {
        existing.userIds.push(currentUserId);
      }
    } else {
      reactions.push({ emoji, userIds: [currentUserId], count: 0 });
    }

    // Recompute counts and prune empty buckets.
    const cleaned = reactions
      .map((r) => ({ ...r, count: r.userIds.length }))
      .filter((r) => r.count > 0);

    const now = new Date();
    await db.collection<MessageDoc>("messages").updateOne(
      { _id: message._id },
      { $set: { reactions: cleaned, updatedAt: now } }
    );

    const updated = { ...message, reactions: cleaned, updatedAt: now };
    return NextResponse.json({ message: formatMessage(updated) });
  } catch (error) {
    console.error("React error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
