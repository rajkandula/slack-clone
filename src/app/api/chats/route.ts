import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { ChatDoc, UserDoc, MessageDoc, MemberDoc } from "@/lib/db-types";
import { ObjectId } from "mongodb";
import { getCoMemberIds, sharesWorkspace, NOT_IN_YOUR_WORKSPACE } from "@/lib/workspace-access";

// GET /api/chats - List all chats of the current user
export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const currentUserId = user._id.toString();
    const db = await getDb();

    // Find all chats where user is a participant
    const chats = await db
      .collection<ChatDoc>("chats")
      .find({ participants: currentUserId })
      .sort({ createdAt: -1 })
      .toArray();

    const formattedChats = await Promise.all(
      chats.map(async (chat) => {
        const chatIdStr = chat._id!.toString();

        // Fetch last message in this chat
        const lastMessage = await db
          .collection<MessageDoc>("messages")
          .findOne({ chatId: chatIdStr }, { sort: { createdAt: -1 } });

        // Calculate unread message count
        const unreadCount = await db.collection<MessageDoc>("messages").countDocuments({
          chatId: chatIdStr,
          senderId: { $ne: currentUserId },
          readBy: { $ne: currentUserId },
        });

        // Resolve chat details
        let name = chat.name || "Group Chat";
        let avatarUrl = chat.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundType=gradientLinear&backgroundColor=7c7cf0,6b8afd,5b8f8a&fontWeight=600&chars=2`;
        let otherUserStatus: "online" | "offline" = "offline";
        let otherUserLastSeen: Date | null = null;

        if (chat.type === "dm") {
          // Find the other participant's ID
          const otherUserIdStr = chat.participants?.find((id) => id !== currentUserId);
          if (otherUserIdStr) {
            const otherUser = await db.collection<UserDoc>("users").findOne({
              _id: new ObjectId(otherUserIdStr),
            });
            if (otherUser) {
              name = otherUser.username;
              avatarUrl = otherUser.avatarUrl || avatarUrl;
              otherUserStatus = otherUser.status || "offline";
              otherUserLastSeen = otherUser.lastSeen || null;
            }
          }
        }

        return {
          id: chatIdStr,
          type: chat.type,
          workspaceId: chat.workspaceId ?? null,
          visibility: chat.visibility ?? null,
          name,
          avatarUrl,
          participants: chat.participants,
          otherUserStatus,
          otherUserLastSeen,
          unreadCount,
          memberCount: chat.memberCount || chat.participants?.length || 0,
          createdAt: chat.createdAt.toISOString(),
          lastMessage: lastMessage
            ? {
                id: lastMessage._id!.toString(),
                text: lastMessage.text,
                mediaType: lastMessage.mediaType,
                senderUsername: lastMessage.senderUsername,
                createdAt: lastMessage.createdAt,
                readBy: lastMessage.readBy,
              }
            : null,
        };
      })
    );

    // Sort chats by last message date, fallback to chat creation date
    formattedChats.sort((a, b) => {
      const dateA = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
      const dateB = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    return NextResponse.json({ chats: formattedChats });
  } catch (error) {
    console.error("List chats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/chats - Update group settings (rename / avatar). Body: { chatId, name?, avatarUrl? }
export async function PATCH(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { chatId, name, avatarUrl, visibility } = await request.json();
    if (!chatId) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }

    const db = await getDb();
    const currentUserId = user._id.toString();

    const chat = await db.collection<ChatDoc>("chats").findOne({
      _id: new ObjectId(chatId),
      participants: currentUserId,
    });
    if (!chat) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    if (chat.type === "dm") return NextResponse.json({ error: "Cannot rename a direct chat" }, { status: 400 });

    const membership = await db.collection<MemberDoc>("members").findOne({ chatId, userId: currentUserId });
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      return NextResponse.json({ error: "Only admins can edit group settings" }, { status: 403 });
    }

    const update: Record<string, unknown> = {};
    if (typeof name === "string" && name.trim()) {
      update.name = name.trim();
      update.title = name.trim();
    }
    if (typeof avatarUrl === "string" && avatarUrl) update.avatarUrl = avatarUrl;
    // Group discoverability. Workspace channels manage visibility separately.
    if ((visibility === "public" || visibility === "private") && chat.type === "group" && !chat.workspaceId) {
      update.visibility = visibility;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    await db.collection<ChatDoc>("chats").updateOne({ _id: chat._id }, { $set: update });
    return NextResponse.json({
      ok: true,
      name: update.name ?? chat.name,
      avatarUrl: update.avatarUrl ?? chat.avatarUrl,
      visibility: update.visibility ?? chat.visibility ?? "private",
    });
  } catch (error) {
    console.error("Update chat error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/chats - Create a new chat
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { type, recipientUsername, name, participantUsernames, visibility } = await request.json();

    if (!type || (type !== "dm" && type !== "group")) {
      return NextResponse.json({ error: "Invalid or missing chat type" }, { status: 400 });
    }

    const db = await getDb();
    const currentUserId = user._id.toString();

    if (type === "dm") {
      if (!recipientUsername) {
        return NextResponse.json({ error: "Recipient username is required" }, { status: 400 });
      }

      const cleanRecipientName = recipientUsername.trim().toLowerCase();
      if (cleanRecipientName === user.username) {
        return NextResponse.json({ error: "Cannot start a chat with yourself" }, { status: 400 });
      }

      // Find recipient user
      const recipientUser = await db.collection<UserDoc>("users").findOne({
        username: cleanRecipientName,
      });

      // Deliberately the same 404 the workspace gate below returns, so the
      // status code can't be used to enumerate which usernames are real.
      if (!recipientUser || !recipientUser._id) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      const recipientId = recipientUser._id.toString();

      // Check if a direct chat already exists
      const existingChat = await db.collection<ChatDoc>("chats").findOne({
        type: "dm",
        participants: { $all: [currentUserId, recipientId], $size: 2 },
      });

      if (existingChat) {
        return NextResponse.json({
          chat: {
            id: existingChat._id!.toString(),
            type: "dm",
            name: recipientUser.username,
            avatarUrl: recipientUser.avatarUrl,
            participants: existingChat.participants,
            otherUserStatus: recipientUser.status,
            otherUserLastSeen: recipientUser.lastSeen,
            unreadCount: 0,
            memberCount: existingChat.memberCount || 2,
            createdAt: existingChat.createdAt.toISOString(),
            lastMessage: null,
          },
        });
      }

      // Discovery gate: you may only *start* a DM with a workspace mate.
      // Deliberately checked after the existing-chat lookup above — a
      // conversation you already have is never revoked, only new ones gated.
      if (!(await sharesWorkspace(db, currentUserId, recipientId))) {
        return NextResponse.json({ error: NOT_IN_YOUR_WORKSPACE }, { status: 404 });
      }

      // Create new direct chat
      const newChat: ChatDoc = {
        type: "dm",
        participants: [currentUserId, recipientId],
        memberCount: 2,
        maxSeq: 0,
        createdAt: new Date(),
      };

      const result = await db.collection<ChatDoc>("chats").insertOne(newChat);
      const chatIdStr = result.insertedId.toString();

      // Insert membership documents
      await db.collection<MemberDoc>("members").insertMany([
        { chatId: chatIdStr, userId: currentUserId, role: "owner", lastReadSeq: 0, joinedAt: new Date() },
        { chatId: chatIdStr, userId: recipientId, role: "member", lastReadSeq: 0, joinedAt: new Date() }
      ]);

      return NextResponse.json({
        chat: {
          id: chatIdStr,
          type: "dm",
          name: recipientUser.username,
          avatarUrl: recipientUser.avatarUrl,
          participants: [currentUserId, recipientId],
          otherUserStatus: recipientUser.status,
          otherUserLastSeen: recipientUser.lastSeen,
          unreadCount: 0,
          memberCount: 2,
          createdAt: newChat.createdAt.toISOString(),
          lastMessage: null,
        },
      });
    } else {
      // Group chat
      if (!name) {
        return NextResponse.json({ error: "Group name is required" }, { status: 400 });
      }

      const userIds = [currentUserId];

      if (participantUsernames && Array.isArray(participantUsernames)) {
        // Same co-member rule as DMs — you can only pull workspace mates into a
        // new group. Resolved once up front rather than per participant.
        const coMemberIds = new Set(await getCoMemberIds(db, currentUserId));

        for (const pUsername of participantUsernames) {
          const cleanPName = pUsername.trim().toLowerCase();
          if (cleanPName === user.username) continue;

          const pUser = await db.collection<UserDoc>("users").findOne({ username: cleanPName });
          if (pUser && pUser._id) {
            const pUserId = pUser._id.toString();
            if (!coMemberIds.has(pUserId)) {
              return NextResponse.json({ error: NOT_IN_YOUR_WORKSPACE }, { status: 403 });
            }
            userIds.push(pUserId);
          }
        }
      }

      const groupAvatarUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
        name
      )}&backgroundType=gradientLinear&backgroundColor=7c7cf0,6b8afd,5b8f8a&fontWeight=600&chars=2`;

      const newGroup: ChatDoc = {
        type: "group",
        // Groups are private unless explicitly made public (discoverable).
        visibility: visibility === "public" ? "public" : "private",
        name,
        avatarUrl: groupAvatarUrl,
        participants: userIds,
        memberCount: userIds.length,
        maxSeq: 0,
        createdAt: new Date(),
      };

      const result = await db.collection<ChatDoc>("chats").insertOne(newGroup);
      const chatIdStr = result.insertedId.toString();

      // Insert membership documents
      const memberDocs = userIds.map((uid, index) => ({
        chatId: chatIdStr,
        userId: uid,
        role: index === 0 ? "owner" as const : "member" as const,
        lastReadSeq: 0,
        joinedAt: new Date()
      }));
      await db.collection<MemberDoc>("members").insertMany(memberDocs);

      return NextResponse.json({
        chat: {
          id: chatIdStr,
          type: "group",
          visibility: newGroup.visibility,
          name,
          avatarUrl: groupAvatarUrl,
          participants: userIds,
          unreadCount: 0,
          memberCount: userIds.length,
          createdAt: newGroup.createdAt.toISOString(),
          lastMessage: null,
        },
      });
    }
  } catch (error) {
    console.error("Create chat error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
