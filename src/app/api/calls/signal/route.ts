import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { ObjectId } from "mongodb";

/** Only these ever reach a peer connection — anything else is dropped at the door. */
const SIGNAL_TYPES = new Set(["offer", "answer", "candidate", "hangup", "decline", "join", "screen_share"]);

// POST /api/calls/signal — relay one WebRTC signal to one peer.
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentUserId = user._id.toString();
    const { callId, recipientId, type, payload } = await request.json();

    if (!callId || !recipientId || !type || payload === undefined) {
      return NextResponse.json(
        { error: "callId, recipientId, type, and payload are required" },
        { status: 400 }
      );
    }

    if (typeof type !== "string" || !SIGNAL_TYPES.has(type)) {
      return NextResponse.json({ error: "Unsupported signal type" }, { status: 400 });
    }

    if (!ObjectId.isValid(callId)) {
      return NextResponse.json({ error: "Invalid callId" }, { status: 400 });
    }

    const db = await getDb();

    const call = await db.collection("calls").findOne({
      _id: new ObjectId(callId),
      status: "active",
    });

    if (!call) {
      return NextResponse.json({ error: "Active call not found" }, { status: 404 });
    }

    // Both ends must belong to the chat the call lives in. Checking only the
    // *sender* would let anyone who can open a call of their own push an offer
    // at any user id and pick up their camera without a prompt; checking only
    // call membership would lock out a callee trying to decline, since
    // accepting is what puts you in `participants`.
    const chat = await db.collection("chats").findOne(
      { _id: new ObjectId(call.chatId) },
      { projection: { participants: 1 } }
    );
    const members: string[] = chat?.participants || [];

    if (!members.includes(currentUserId)) {
      return NextResponse.json({ error: "You are not a participant of this call" }, { status: 403 });
    }
    if (!members.includes(recipientId)) {
      return NextResponse.json({ error: "Recipient is not in this conversation" }, { status: 403 });
    }

    // Media-plane signals additionally require the sender to have actually
    // joined; only ring-plane messages (hangup/decline) may come from a callee
    // who has not accepted yet.
    if (type !== "hangup" && type !== "decline" && !(call.participants || []).includes(currentUserId)) {
      return NextResponse.json({ error: "Join the call before signalling" }, { status: 403 });
    }

    await db.collection("signaling_updates").insertOne({
      senderId: currentUserId,
      recipientId,
      callId,
      type,
      payload,
      createdAt: new Date(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Signal API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
