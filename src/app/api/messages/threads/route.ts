import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { ChatDoc, MessageDoc } from "@/lib/db-types";
import { ObjectId } from "mongodb";

// GET /api/messages/threads?threadId=xxxx - Fetch replies in a thread
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get("threadId");

    if (!threadId) {
      return NextResponse.json({ error: "threadId is required" }, { status: 400 });
    }

    const currentUserId = user._id.toString();
    const db = await getDb();

    // 1. Fetch parent message to locate the chat and verify membership
    const parentMessage = await db.collection<MessageDoc>("messages").findOne({
      _id: new ObjectId(threadId),
    });

    if (!parentMessage) {
      return NextResponse.json({ error: "Parent message not found" }, { status: 404 });
    }

    // 2. Verify current user is a participant of the parent message's chat
    const chat = await db.collection<ChatDoc>("chats").findOne({
      _id: new ObjectId(parentMessage.chatId),
      participants: currentUserId,
    });

    if (!chat) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // 3. Fetch all threaded replies
    const replies = await db
      .collection<MessageDoc>("messages")
      .find({ chatId: parentMessage.chatId, threadId: threadId })
      .sort({ seq: 1 })
      .toArray();

    const formattedReplies = replies.map((msg) => ({
      id: msg._id!.toString(),
      chatId: msg.chatId,
      senderId: msg.senderId,
      senderUsername: msg.senderUsername,
      seq: Number(msg.seq),
      threadId: msg.threadId,
      text: msg.text,
      mediaUrl: msg.mediaUrl,
      mediaType: msg.mediaType,
      mediaName: msg.mediaName,
      mediaSize: msg.mediaSize,
      readBy: msg.readBy,
      createdAt: msg.createdAt,
    }));

    return NextResponse.json({
      parentMessage: {
        id: parentMessage._id!.toString(),
        chatId: parentMessage.chatId,
        senderId: parentMessage.senderId,
        senderUsername: parentMessage.senderUsername,
        text: parentMessage.text,
        mediaUrl: parentMessage.mediaUrl,
        mediaType: parentMessage.mediaType,
        mediaName: parentMessage.mediaName,
        createdAt: parentMessage.createdAt,
      },
      replies: formattedReplies,
    });
  } catch (error) {
    console.error("Fetch thread replies error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
