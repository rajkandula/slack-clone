import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { jwtSecret } from "@/lib/secret";
import { getTurnIceServers } from "@/lib/turn";
import { pushToInactiveParticipants } from "@/lib/push";
import { Db, ObjectId } from "mongodb";

/**
 * Proof of call membership for a WebSocket signalling hub at /ws/rtc, when
 * one is deployed in front of the app. The hub trusts this token alone, so it is only minted here — after the
 * chat-membership check — and scoped to one call.
 */
function rtcToken(callId: string, userId: string): string {
  return jwt.sign({ kind: "rtc", callId, userId }, jwtSecret(), { expiresIn: "6h" });
}

/**
 * A client in a call refreshes `heartbeatAt` from its SSE tick (every 1.5s).
 * Anything staler than this lost its browser — a crashed tab used to leave an
 * `active` doc behind forever, and every later caller would silently *join the
 * corpse* instead of ringing the room.
 */
const STALE_CALL_MS = 30_000;

type CallDoc = {
  _id?: ObjectId;
  chatId: string;
  type: "audio" | "video";
  status: string;
  hostId?: string;
  participants?: string[];
  heartbeatAt?: Date | null;
  endedAt?: Date | null;
  createdAt: Date;
};

/** End any call in this chat whose participants have all gone quiet. */
async function reapStaleCalls(db: Db, chatId: string) {
  await db.collection<CallDoc>("calls").updateMany(
    {
      chatId,
      status: "active",
      $or: [
        { heartbeatAt: { $lt: new Date(Date.now() - STALE_CALL_MS) } },
        { heartbeatAt: { $exists: false }, createdAt: { $lt: new Date(Date.now() - STALE_CALL_MS) } },
      ],
    },
    { $set: { status: "ended", participants: [], endedAt: new Date() } }
  );
}

async function serializeCall(db: Db, call: CallDoc) {
  const ids = (call.participants || []).filter((id) => ObjectId.isValid(id));
  const users = ids.length
    ? await db
        .collection("users")
        .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } })
        .project({ passwordHash: 0 })
        .toArray()
    : [];

  return {
    id: call._id!.toString(),
    chatId: call.chatId,
    type: call.type,
    status: call.status,
    hostId: call.hostId,
    participants: users.map((u) => ({
      id: u._id.toString(),
      username: u.username,
      displayName: u.displayName || u.username,
      avatarUrl: u.avatarUrl,
    })),
    createdAt: call.createdAt,
  };
}

function ringDocs(
  recipients: string[],
  senderId: string,
  callId: string,
  payload: Record<string, unknown>,
  type: string
) {
  return recipients.map((recipientId) => ({
    senderId,
    recipientId,
    callId,
    type,
    payload,
    createdAt: new Date(),
  }));
}

// GET /api/calls?chatId=... — is there a live call in this chat?
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chatId");
    if (!chatId || !ObjectId.isValid(chatId)) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }

    const db = await getDb();
    const chat = await db.collection("chats").findOne({
      _id: new ObjectId(chatId),
      participants: user._id.toString(),
    });
    if (!chat) {
      return NextResponse.json({ error: "Chat not found or access denied" }, { status: 404 });
    }

    await reapStaleCalls(db, chatId);

    const call = await db.collection<CallDoc>("calls").findOne({ chatId, status: "active" });
    if (!call) return NextResponse.json({ call: null });

    return NextResponse.json({ call: await serializeCall(db, call) });
  } catch (error) {
    console.error("GET calls error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/calls — start a call, or join the one already running in this chat.
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentUserId = user._id.toString();
    const { chatId, type } = await request.json();

    if (!chatId || !ObjectId.isValid(chatId) || (type !== "audio" && type !== "video")) {
      return NextResponse.json({ error: "chatId and a valid type are required" }, { status: 400 });
    }

    const db = await getDb();

    const chat = await db.collection("chats").findOne({
      _id: new ObjectId(chatId),
      participants: currentUserId,
    });
    if (!chat) {
      return NextResponse.json({ error: "Chat not found or access denied" }, { status: 404 });
    }

    await reapStaleCalls(db, chatId);

    // Start-or-join in a single round trip. The previous read-then-write let two
    // people dialling at once create two `active` docs (both sitting in an empty
    // room), and let two people accepting on the same SSE tick each read a
    // participant list that omitted the other — so they never connected.
    const now = new Date();
    const upsert = () =>
      db.collection<CallDoc>("calls").findOneAndUpdate(
        { chatId, status: "active" },
        {
          $setOnInsert: {
            chatId,
            type,
            status: "active",
            hostId: currentUserId,
            createdAt: now,
            endedAt: null,
          },
          $addToSet: { participants: currentUserId },
          $set: { heartbeatAt: now },
        },
        { upsert: true, returnDocument: "after", includeResultMetadata: true }
      );

    let result;
    try {
      result = await upsert();
    } catch (err) {
      // Lost the race against the unique partial index — the other caller's doc
      // is now the call, so join that instead.
      if ((err as { code?: number }).code !== 11000) throw err;
      result = await upsert();
    }

    const call = result.value;
    if (!call) {
      return NextResponse.json({ error: "Could not open the call" }, { status: 500 });
    }
    const isNewCall = !!result.lastErrorObject?.upserted;

    const payload = {
      chatId,
      callerName: user.displayName || user.username,
      type: call.type,
    };

    // A brand-new call rings everyone in the chat; joining an existing one tells
    // the people already in it to open a peer connection to me. Both lists come
    // from the post-update doc, never from a stale client-side snapshot.
    const recipients = isNewCall
      ? (chat.participants || []).filter((id: string) => id !== currentUserId)
      : (call.participants || []).filter((id: string) => id !== currentUserId);

    if (recipients.length > 0) {
      await db
        .collection("signaling_updates")
        .insertMany(ringDocs(recipients, currentUserId, call._id!.toString(), payload, "join"));

      // Ring phones with the app closed. Short throttle window — a second call
      // minutes after the first should still buzz.
      void pushToInactiveParticipants(db, chatId, recipients, {
        title: `Incoming ${call.type} call`,
        body: `${user.displayName || user.username} is calling you on WASP`,
        url: `/messages?chatId=${chatId}`,
        tag: `call-${chatId}`,
      }, 30_000).catch((err) => console.error("Call push failed:", err));
    }

    return NextResponse.json({
      call: await serializeCall(db, call),
      rtcToken: rtcToken(call._id!.toString(), currentUserId),
      // Fresh relay credentials so the call works behind carrier NAT and
      // strict firewalls; null when TURN is not configured (STUN-only).
      iceServers: await getTurnIceServers(),
    });
  } catch (error) {
    console.error("POST calls error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/calls?callId=... — leave (and, if you were the last one, end) a call.
export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentUserId = user._id.toString();
    const { searchParams } = new URL(request.url);
    const callId = searchParams.get("callId");

    if (!callId || !ObjectId.isValid(callId)) {
      return NextResponse.json({ error: "callId is required" }, { status: 400 });
    }

    const db = await getDb();
    const call = await db.collection<CallDoc>("calls").findOneAndUpdate(
      { _id: new ObjectId(callId), participants: currentUserId },
      { $pull: { participants: currentUserId } },
      { returnDocument: "after" }
    );

    if (!call) {
      return NextResponse.json({ error: "Call not found or user not in call" }, { status: 404 });
    }

    const remaining = (call.participants || []).filter((id) => id !== currentUserId);

    if (remaining.length === 0) {
      await db
        .collection<CallDoc>("calls")
        .updateOne({ _id: call._id }, { $set: { status: "ended", endedAt: new Date() } });
    }

    // When the room empties, the people still *ringing* have to be told too —
    // they were never added to `participants` (accepting is what adds you), so
    // deriving the hangup list from participants alone left their phone ringing
    // forever, and accepting ten minutes later opened a brand-new call.
    let recipients = remaining;
    if (recipients.length === 0) {
      const chat = await db.collection("chats").findOne(
        { _id: new ObjectId(call.chatId) },
        { projection: { participants: 1 } }
      );
      recipients = (chat?.participants || []).filter((id: string) => id !== currentUserId);
    }

    if (recipients.length > 0) {
      await db
        .collection("signaling_updates")
        .insertMany(ringDocs(recipients, currentUserId, callId, {}, "hangup"));
    }

    return NextResponse.json({ message: "Left call successfully" });
  } catch (error) {
    console.error("DELETE calls error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
