import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { ChatDoc } from "@/lib/db-types";
import { ObjectId } from "mongodb";

// POST /api/typing - Signal that the current user is typing in a chat.
// Body: { chatId }. The record self-expires after a few seconds.
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { chatId } = await request.json();
    if (!chatId) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }

    const currentUserId = user._id.toString();
    const db = await getDb();

    // Confirm membership before broadcasting typing.
    const chat = await db.collection<ChatDoc>("chats").findOne({
      _id: new ObjectId(chatId),
      participants: currentUserId,
    });
    if (!chat) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    await db.collection("typing").updateOne(
      { chatId, userId: currentUserId },
      {
        $set: {
          chatId,
          userId: currentUserId,
          username: user.username,
          expiresAt: new Date(Date.now() + 5000),
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Typing signal error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
