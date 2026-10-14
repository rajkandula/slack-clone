import { NextResponse } from "next/server";
import { NOT_IN_YOUR_WORKSPACE, sharesWorkspace } from "@/lib/workspace-access";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { ChatDoc, UserDoc, MemberDoc } from "@/lib/db-types";
import { ObjectId } from "mongodb";

async function loadChatAndActor(chatId: string, actorId: string) {
  const db = await getDb();
  const chat = await db.collection<ChatDoc>("chats").findOne({
    _id: new ObjectId(chatId),
    participants: actorId,
  });
  if (!chat) return { db, chat: null, actorMembership: null };
  const actorMembership = await db
    .collection<MemberDoc>("members")
    .findOne({ chatId, userId: actorId });
  return { db, chat, actorMembership };
}

// GET /api/chats/members?chatId=xxx - List members with roles + profiles.
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const chatId = new URL(request.url).searchParams.get("chatId");
    if (!chatId) return NextResponse.json({ error: "chatId is required" }, { status: 400 });

    const actorId = user._id.toString();
    const { db, chat } = await loadChatAndActor(chatId, actorId);
    if (!chat) return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const members = await db.collection<MemberDoc>("members").find({ chatId }).toArray();
    const userIds = members.map((m) => new ObjectId(m.userId));
    const users = await db.collection<UserDoc>("users").find({ _id: { $in: userIds } }).toArray();
    const userMap = new Map(users.map((u) => [u._id!.toString(), u]));

    const result = members.map((m) => {
      const u = userMap.get(m.userId);
      return {
        userId: m.userId,
        username: u?.username || "unknown",
        avatarUrl: u?.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(u?.username || "user")}&backgroundType=gradientLinear&backgroundColor=7c7cf0,6b8afd,5b8f8a&fontWeight=600&chars=2`,
        role: m.role,
        status: u?.status || "offline",
        isSelf: m.userId === actorId,
      };
    });

    // Owner first, then admins, then members.
    const order = { owner: 0, admin: 1, member: 2, restricted: 3, banned: 4 } as Record<string, number>;
    result.sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));

    return NextResponse.json({ members: result });
  } catch (error) {
    console.error("List members error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/chats/members - Add a member by username. Body: { chatId, username }
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { chatId, username } = await request.json();
    if (!chatId || !username) return NextResponse.json({ error: "chatId and username required" }, { status: 400 });

    const actorId = user._id.toString();
    const { db, chat, actorMembership } = await loadChatAndActor(chatId, actorId);
    if (!chat) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    if (chat.type === "dm") return NextResponse.json({ error: "Cannot add members to a direct chat" }, { status: 400 });
    if (!actorMembership || (actorMembership.role !== "owner" && actorMembership.role !== "admin")) {
      return NextResponse.json({ error: "Only admins can add members" }, { status: 403 });
    }

    const target = await db.collection<UserDoc>("users").findOne({ username: username.trim().toLowerCase() });
    if (!target || !target._id) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const targetId = target._id.toString();

    // Without this, the invite-only model collapses: anyone could make an empty
    // group, become its owner, then pull in any account by username. Adding
    // someone is reaching them, so it needs the same gate as starting a DM.
    if (!(await sharesWorkspace(db, actorId, targetId))) {
      return NextResponse.json({ error: NOT_IN_YOUR_WORKSPACE }, { status: 403 });
    }

    if (chat.participants?.includes(targetId)) {
      return NextResponse.json({ error: "User is already a member" }, { status: 400 });
    }

    await db.collection<ChatDoc>("chats").updateOne(
      { _id: chat._id },
      { $addToSet: { participants: targetId }, $inc: { memberCount: 1 } }
    );
    await db.collection<MemberDoc>("members").updateOne(
      { chatId, userId: targetId },
      { $set: { chatId, userId: targetId, role: "member", lastReadSeq: chat.maxSeq, joinedAt: new Date() } },
      { upsert: true }
    );

    return NextResponse.json({ ok: true, added: { userId: targetId, username: target.username } });
  } catch (error) {
    console.error("Add member error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/chats/members?chatId=xxx&userId=yyy - Remove a member (admin) or leave (self).
export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chatId");
    const targetId = searchParams.get("userId");
    if (!chatId || !targetId) return NextResponse.json({ error: "chatId and userId required" }, { status: 400 });

    const actorId = user._id.toString();
    const { db, chat, actorMembership } = await loadChatAndActor(chatId, actorId);
    if (!chat) return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const isSelf = targetId === actorId;
    const isAdmin = actorMembership?.role === "owner" || actorMembership?.role === "admin";
    if (!isSelf && !isAdmin) {
      return NextResponse.json({ error: "Only admins can remove members" }, { status: 403 });
    }

    const targetMembership = await db.collection<MemberDoc>("members").findOne({ chatId, userId: targetId });
    if (targetMembership?.role === "owner") {
      return NextResponse.json({ error: "The group owner cannot be removed" }, { status: 400 });
    }

    await db.collection<ChatDoc>("chats").updateOne(
      { _id: chat._id },
      { $pull: { participants: targetId }, $inc: { memberCount: -1 } }
    );
    await db.collection<MemberDoc>("members").deleteOne({ chatId, userId: targetId });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Remove member error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/chats/members - Promote/demote a member. Body: { chatId, userId, role: "admin"|"member" }
export async function PATCH(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { chatId, userId: targetId, role } = await request.json();
    if (!chatId || !targetId || !["admin", "member"].includes(role)) {
      return NextResponse.json({ error: "chatId, userId and a valid role are required" }, { status: 400 });
    }

    const actorId = user._id.toString();
    const { db, chat, actorMembership } = await loadChatAndActor(chatId, actorId);
    if (!chat) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    if (!actorMembership || (actorMembership.role !== "owner" && actorMembership.role !== "admin")) {
      return NextResponse.json({ error: "Only admins can change roles" }, { status: 403 });
    }

    const targetMembership = await db.collection<MemberDoc>("members").findOne({ chatId, userId: targetId });
    if (!targetMembership) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (targetMembership.role === "owner") {
      return NextResponse.json({ error: "Cannot change the owner's role" }, { status: 400 });
    }

    await db.collection<MemberDoc>("members").updateOne({ chatId, userId: targetId }, { $set: { role } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Change role error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
