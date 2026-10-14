import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { ChatDoc, MemberDoc, WorkspaceMemberDoc } from "@/lib/db-types";
import { getWorkspaceMembership } from "@/lib/workspace-helpers";
import { ObjectId } from "mongodb";

// GET /api/workspaces/channels?workspaceId=… — channels of a workspace,
// with a joined flag for the caller (private channels only appear if joined).
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const db = await getDb();
    const userId = user._id.toString();

    const membership = await getWorkspaceMembership(db, workspaceId, userId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace" }, { status: 403 });
    }

    const channels = await db
      .collection<ChatDoc>("chats")
      .find({
        workspaceId,
        $or: [{ visibility: "public" }, { participants: userId }],
      })
      .sort({ createdAt: 1 })
      .toArray();

    return NextResponse.json({
      channels: channels.map((c) => ({
        id: c._id!.toString(),
        name: c.name || c.title || "channel",
        visibility: c.visibility ?? "public",
        memberCount: c.memberCount || c.participants?.length || 0,
        joined: c.participants?.includes(userId) ?? false,
        createdAt: c.createdAt.toISOString(),
      })),
      role: membership.role,
    });
  } catch (error) {
    console.error("List channels error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/workspaces/channels — create a channel.
// Body: { workspaceId, name, visibility? }. Public channels enroll every
// workspace member so the whole workspace gets the channel and its updates.
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { workspaceId, name, visibility } = await request.json();
    const cleanName = typeof name === "string" ? name.trim().toLowerCase().replace(/\s+/g, "-") : "";
    if (!workspaceId || !cleanName || cleanName.length > 50) {
      return NextResponse.json(
        { error: "workspaceId and a channel name (max 50 chars) are required" },
        { status: 400 }
      );
    }
    const vis = visibility === "private" ? "private" : "public";

    const db = await getDb();
    const userId = user._id.toString();

    const membership = await getWorkspaceMembership(db, workspaceId, userId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace" }, { status: 403 });
    }

    const duplicate = await db
      .collection<ChatDoc>("chats")
      .findOne({ workspaceId, name: cleanName });
    if (duplicate) {
      return NextResponse.json(
        { error: `#${cleanName} already exists in this workspace` },
        { status: 409 }
      );
    }

    // Public channels include every current workspace member from day one.
    let participantIds = [userId];
    if (vis === "public") {
      const wsMembers = await db
        .collection<WorkspaceMemberDoc>("workspace_members")
        .find({ workspaceId })
        .toArray();
      participantIds = wsMembers.map((m) => m.userId);
      if (!participantIds.includes(userId)) participantIds.push(userId);
    }

    const channel: ChatDoc = {
      type: "channel",
      workspaceId,
      visibility: vis,
      name: cleanName,
      title: cleanName,
      participants: participantIds,
      memberCount: participantIds.length,
      maxSeq: 0,
      createdAt: new Date(),
    };
    const result = await db.collection<ChatDoc>("chats").insertOne(channel);
    const chatId = result.insertedId.toString();

    await db.collection<MemberDoc>("members").insertMany(
      participantIds.map((uid) => ({
        chatId,
        userId: uid,
        role: uid === userId ? ("owner" as const) : ("member" as const),
        lastReadSeq: 0,
        joinedAt: new Date(),
      }))
    );

    return NextResponse.json({
      channel: {
        id: chatId,
        name: cleanName,
        visibility: vis,
        memberCount: participantIds.length,
        joined: true,
        createdAt: channel.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Create channel error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/workspaces/channels — rejoin a public channel you previously left.
// Body: { chatId }
export async function PATCH(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { chatId } = await request.json();
    if (!chatId || !ObjectId.isValid(chatId)) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }

    const db = await getDb();
    const userId = user._id.toString();

    const channel = await db
      .collection<ChatDoc>("chats")
      .findOne({ _id: new ObjectId(chatId), type: "channel" });
    if (!channel || !channel.workspaceId) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    if (channel.visibility !== "public") {
      return NextResponse.json(
        { error: "Private channels are invite-only" },
        { status: 403 }
      );
    }

    const membership = await getWorkspaceMembership(db, channel.workspaceId, userId);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace" }, { status: 403 });
    }

    if (!channel.participants?.includes(userId)) {
      await db.collection<ChatDoc>("chats").updateOne(
        { _id: channel._id },
        { $addToSet: { participants: userId }, $inc: { memberCount: 1 } }
      );
      await db.collection<MemberDoc>("members").updateOne(
        { chatId, userId },
        {
          $setOnInsert: {
            chatId,
            userId,
            role: "member",
            lastReadSeq: 0,
            joinedAt: new Date(),
          },
        },
        { upsert: true }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Join channel error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
