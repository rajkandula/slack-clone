import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { ChatDoc, MessageDoc, MemberDoc } from "@/lib/db-types";
import { ObjectId } from "mongodb";

// POST /api/messages/pin - Pin or unpin a message in a chat.
// Body: { messageId, pin: boolean }
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { messageId, pin } = await request.json();
    if (!messageId) {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }

    const currentUserId = user._id.toString();
    const db = await getDb();

    const message = await db.collection<MessageDoc>("messages").findOne({ _id: new ObjectId(messageId) });
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const chat = await db.collection<ChatDoc>("chats").findOne({
      _id: new ObjectId(message.chatId),
      participants: currentUserId,
    });
    if (!chat) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // In groups/channels only admins/owner may pin. DMs: either participant.
    if (chat.type !== "dm") {
      const membership = await db
        .collection<MemberDoc>("members")
        .findOne({ chatId: message.chatId, userId: currentUserId });
      if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
        return NextResponse.json({ error: "Only admins can pin messages" }, { status: 403 });
      }
    }

    if (pin) {
      await db.collection<ChatDoc>("chats").updateOne(
        { _id: chat._id },
        { $addToSet: { pinnedMessageIds: message._id } }
      );
    } else {
      await db.collection<ChatDoc>("chats").updateOne(
        { _id: chat._id },
        { $pull: { pinnedMessageIds: message._id } }
      );
    }

    const fresh = await db.collection<ChatDoc>("chats").findOne({ _id: chat._id });
    return NextResponse.json({
      pinnedMessageIds: (fresh?.pinnedMessageIds || []).map((id) => id.toString()),
    });
  } catch (error) {
    console.error("Pin error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
