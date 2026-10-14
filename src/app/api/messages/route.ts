import { NextResponse } from "next/server";
import { resolveAssets } from "@/lib/media-pipeline";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { ChatDoc, MessageDoc, MemberDoc } from "@/lib/db-types";
import { pushToInactiveParticipants } from "@/lib/push";
import { ObjectId } from "mongodb";

// Shared serializer so every endpoint returns the same rich shape to the client.
export function formatMessage(msg: MessageDoc) {
  return {
    id: msg._id!.toString(),
    chatId: msg.chatId,
    senderId: msg.senderId,
    senderUsername: msg.senderUsername,
    seq: Number(msg.seq),
    threadId: msg.threadId ?? null,
    text: msg.deletedAt ? null : msg.text,
    mediaUrl: msg.deletedAt ? undefined : msg.mediaUrl,
    mediaType: msg.deletedAt ? undefined : msg.mediaType,
    mediaName: msg.deletedAt ? undefined : msg.mediaName,
    mediaSize: msg.deletedAt ? undefined : msg.mediaSize,
    reactions: msg.reactions ?? [],
    replyTo: msg.replyTo ?? null,
    forwardFrom: msg.forwardFrom ?? null,
    editedAt: msg.editedAt ?? null,
    deletedAt: msg.deletedAt ?? null,
    readBy: msg.readBy || [msg.senderId],
    createdAt: msg.createdAt,
  };
}

async function getMembership(db: Awaited<ReturnType<typeof getDb>>, chatId: string, userId: string) {
  return db.collection<MemberDoc>("members").findOne({ chatId, userId });
}

// GET /api/messages?chatId=xxxx - Fetch conversation history
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chatId");

    if (!chatId) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }

    const currentUserId = user._id.toString();
    const db = await getDb();

    // 1. Verify user is in the chat
    const chat = await db.collection<ChatDoc>("chats").findOne({
      _id: new ObjectId(chatId),
      participants: currentUserId,
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat not found or access denied" }, { status: 403 });
    }

    // 2. Fetch messages (only top-level messages, i.e., those without threadId, unless we are browsing a thread)
    const messages = await db
      .collection<MessageDoc>("messages")
      // hiddenFor = "delete for me": gone for those users, untouched for everyone else.
      .find({ chatId, threadId: null, hiddenFor: { $ne: currentUserId } })
      .sort({ seq: 1 })
      .toArray();

    // 3. Mark messages from others as read
    await db.collection<MessageDoc>("messages").updateMany(
      {
        chatId,
        senderId: { $ne: currentUserId },
        readBy: { $ne: currentUserId },
      },
      {
        $addToSet: { readBy: currentUserId },
      }
    );

    // Update member's lastReadSeq to the chat's maxSeq
    await db.collection<MemberDoc>("members").updateOne(
      { chatId, userId: currentUserId },
      { $set: { lastReadSeq: chat.maxSeq } }
    );

    // Swap in optimised renditions (e.g. transcoded videos) where available.
    const assetMap = await resolveAssets(db, messages.map((m) => m.mediaUrl || "").filter(Boolean));
    const formatted = messages.map((m) => {
      const f = formatMessage(m);
      const a = m.mediaUrl ? assetMap.get(m.mediaUrl) : undefined;
      return a
        ? {
            ...f,
            mediaUrl: a.url,
            mediaOriginalUrl: a.originalUrl,
            mediaThumbUrl: a.thumbUrl,
            // Borderline media stays blurred in chat too, not just in the feed.
            mediaSensitive: a.sensitive,
          }
        : f;
    });

    // Thread reply counts, so the feed can show "N replies" on parents.
    const parentIds = messages.map((m) => m._id!.toString());
    const counts = await db
      .collection<MessageDoc>("messages")
      .aggregate<{ _id: string; n: number }>([
        { $match: { chatId, threadId: { $in: parentIds } } },
        { $group: { _id: "$threadId", n: { $sum: 1 } } },
      ])
      .toArray();
    const countMap = new Map(counts.map((c) => [c._id, c.n]));
    const withThreads = formatted.map((f) => {
      const n = countMap.get(f.id);
      return n ? { ...f, threadCount: n } : f;
    });

    return NextResponse.json({
      messages: withThreads,
      pinnedMessageIds: (chat.pinnedMessageIds || []).map((id) => id.toString()),
    });
  } catch (error) {
    console.error("Fetch messages error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/messages - Send a message (Idempotent & sequenced)
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { chatId, text, mediaUrl, mediaType, mediaName, mediaSize, clientMsgId, threadId, replyTo, forwardFrom } =
      await request.json();

    if (!chatId) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }

    if (!text && !mediaUrl) {
      return NextResponse.json(
        { error: "Message must contain text or a media attachment" },
        { status: 400 }
      );
    }

    const currentUserId = user._id.toString();
    const db = await getDb();

    // 1. Verify user is in the chat
    const chat = await db.collection<ChatDoc>("chats").findOne({
      _id: new ObjectId(chatId),
      participants: currentUserId,
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat not found or access denied" }, { status: 403 });
    }

    // 1b. Enforce posting permission. Standalone (broadcast) channels are
    // admin-post-only; workspace channels are conversational — any member
    // of the channel may post, Slack-style.
    if (chat.type === "channel" && !chat.workspaceId) {
      const membership = await getMembership(db, chatId, currentUserId);
      if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
        return NextResponse.json({ error: "Only admins can post in this channel" }, { status: 403 });
      }
    }

    // 2. Idempotency check
    if (clientMsgId) {
      const existingMessage = await db.collection<MessageDoc>("messages").findOne({
        chatId,
        clientMsgId,
      });

      if (existingMessage) {
        return NextResponse.json({ message: formatMessage(existingMessage) });
      }
    }

    // 3. Increment monotonic sequence counter on the chat
    const chatUpdateResult = await db.collection<ChatDoc>("chats").findOneAndUpdate(
      { _id: new ObjectId(chatId) },
      { $inc: { maxSeq: 1 } },
      { returnDocument: "after" }
    );

    if (!chatUpdateResult) {
      return NextResponse.json({ error: "Chat update failed" }, { status: 500 });
    }

    const newSeq = chatUpdateResult.maxSeq;

    // 4. Create and Insert message document
    const now = new Date();
    const newMessage: MessageDoc = {
      chatId,
      seq: newSeq,
      // Omit clientMsgId entirely when absent: the sparse unique index still
      // indexes explicit nulls, so `null` would collide on the second
      // id-less message in a chat.
      ...(clientMsgId ? { clientMsgId } : {}),
      threadId: threadId || null,
      senderId: currentUserId,
      senderUsername: user.username,
      type: mediaType ? (mediaType === "image" ? "photo" : mediaType === "video" ? "video" : "file") : "text",
      text,
      mediaUrl,
      mediaType,
      mediaName,
      mediaSize,
      replyTo: replyTo && replyTo.messageId ? { messageId: replyTo.messageId, quote: replyTo.quote ?? null } : null,
      forwardFrom: forwardFrom || null,
      reactions: [],
      readBy: [currentUserId],
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection<MessageDoc>("messages").insertOne(newMessage);
    newMessage._id = result.insertedId;
    const messageId = result.insertedId.toString();

    // 5. Update lastReadSeq for sender in members collection
    await db.collection<MemberDoc>("members").updateOne(
      { chatId, userId: currentUserId },
      { $set: { lastReadSeq: newSeq } },
      { upsert: true }
    );

    // 6. Update denormalized lastMessage preview (skip for thread replies)
    if (!newMessage.threadId) {
      await db.collection<ChatDoc>("chats").updateOne(
        { _id: new ObjectId(chatId) },
        {
          $set: {
            lastMessage: {
              id: messageId,
              seq: newSeq,
              senderId: currentUserId,
              type: newMessage.type,
              text: newMessage.text || "📎 Attachment",
              createdAt: now,
            },
          },
        }
      );
    }

    // 7. Update presence timestamp for this user in DB
    await db.collection("users").updateOne(
      { _id: user._id },
      { $set: { lastSeen: new Date(), status: "online" } }
    );

    // 8. Wake devices whose realtime stream is gone. Fire-and-forget: a push
    // provider hiccup must never slow down message send.
    const recipients = (chat.participants || []).filter((id) => id !== currentUserId);
    const sender = user.displayName || user.username;
    const preview = newMessage.text
      ? newMessage.text.slice(0, 120)
      : mediaType === "image" ? "📷 Photo" : mediaType === "video" ? "🎬 Video" : "📎 Attachment";
    void pushToInactiveParticipants(db, chatId, recipients, {
      title: chat.type === "dm" ? sender : `${sender} · ${chat.name || chat.title || "Group"}`,
      body: preview,
      url: `/messages?chatId=${chatId}`,
      tag: `chat-${chatId}`,
    }).catch((err) => console.error("Push notify failed:", err));

    return NextResponse.json({ message: formatMessage(newMessage) });
  } catch (error) {
    console.error("Send message error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/messages - Edit a message's text. Body: { messageId, text }
export async function PATCH(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { messageId, text } = await request.json();
    if (!messageId || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "messageId and non-empty text are required" }, { status: 400 });
    }

    const currentUserId = user._id.toString();
    const db = await getDb();

    const message = await db.collection<MessageDoc>("messages").findOne({ _id: new ObjectId(messageId) });
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    if (message.senderId !== currentUserId) {
      return NextResponse.json({ error: "You can only edit your own messages" }, { status: 403 });
    }
    if (message.deletedAt) {
      return NextResponse.json({ error: "Cannot edit a deleted message" }, { status: 400 });
    }

    const now = new Date();
    await db.collection<MessageDoc>("messages").updateOne(
      { _id: message._id },
      { $set: { text: text.trim(), editedAt: now, updatedAt: now } }
    );

    // Keep the chat preview fresh if this was the last message.
    await db.collection<ChatDoc>("chats").updateOne(
      { _id: new ObjectId(message.chatId), "lastMessage.id": messageId },
      { $set: { "lastMessage.text": text.trim() } }
    );

    const updated = { ...message, text: text.trim(), editedAt: now, updatedAt: now };
    return NextResponse.json({ message: formatMessage(updated) });
  } catch (error) {
    console.error("Edit message error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/messages?messageId=xxx - Soft-delete a message.
export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get("messageId");
    const scope = searchParams.get("scope") || "everyone";
    if (!messageId) {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }

    const currentUserId = user._id.toString();
    const db = await getDb();

    const message = await db.collection<MessageDoc>("messages").findOne({ _id: new ObjectId(messageId) });
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // "Delete for me": any chat member may hide any message from their own
    // view — the message itself is untouched for everyone else.
    if (scope === "me") {
      const chat = await db.collection<ChatDoc>("chats").findOne({
        _id: new ObjectId(message.chatId),
        participants: currentUserId,
      });
      if (!chat) {
        return NextResponse.json({ error: "Not in this chat" }, { status: 403 });
      }
      await db.collection<MessageDoc>("messages").updateOne(
        { _id: message._id },
        { $addToSet: { hiddenFor: currentUserId } }
      );
      return NextResponse.json({ hidden: true, messageId });
    }

    // Sender can always delete; chat admins/owner can delete anyone's message.
    let allowed = message.senderId === currentUserId;
    if (!allowed) {
      const membership = await getMembership(db, message.chatId, currentUserId);
      allowed = !!membership && (membership.role === "owner" || membership.role === "admin");
    }
    if (!allowed) {
      return NextResponse.json({ error: "Not allowed to delete this message" }, { status: 403 });
    }

    const now = new Date();
    await db.collection<MessageDoc>("messages").updateOne(
      { _id: message._id },
      {
        $set: {
          deletedAt: now,
          updatedAt: now,
          text: null,
          mediaUrl: undefined,
          mediaType: undefined,
          mediaName: undefined,
          reactions: [],
        },
      }
    );

    // Drop it from pinned list if present.
    await db.collection<ChatDoc>("chats").updateOne(
      { _id: new ObjectId(message.chatId) },
      { $pull: { pinnedMessageIds: message._id } }
    );

    const updated = { ...message, deletedAt: now, updatedAt: now, text: null };
    return NextResponse.json({ message: formatMessage(updated) });
  } catch (error) {
    console.error("Delete message error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
