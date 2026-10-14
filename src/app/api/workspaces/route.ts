import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { ChatDoc, MemberDoc, WorkspaceDoc, WorkspaceMemberDoc } from "@/lib/db-types";
import {
  findWorkspaceById,
  formatWorkspace,
  getWorkspaceMembership,
  newInviteCode,
  workspaceAvatar,
} from "@/lib/workspace-helpers";
import { ObjectId } from "mongodb";

// GET /api/workspaces — workspaces the current user belongs to
export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = await getDb();
    const userId = user._id.toString();

    const memberships = await db
      .collection<WorkspaceMemberDoc>("workspace_members")
      .find({ userId })
      .toArray();

    if (memberships.length === 0) return NextResponse.json({ workspaces: [] });

    const roleByWs = new Map(memberships.map((m) => [m.workspaceId, m.role]));
    const docs = await db
      .collection<WorkspaceDoc>("workspaces")
      .find({ _id: { $in: memberships.map((m) => new ObjectId(m.workspaceId)) } })
      .sort({ createdAt: 1 })
      .toArray();

    return NextResponse.json({
      workspaces: docs.map((ws) =>
        formatWorkspace(ws, roleByWs.get(ws._id!.toString()) ?? "member")
      ),
    });
  } catch (error) {
    console.error("List workspaces error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/workspaces — create a workspace. Body: { name, description? }
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, description } = await request.json();
    const cleanName = typeof name === "string" ? name.trim() : "";
    if (!cleanName || cleanName.length > 60) {
      return NextResponse.json(
        { error: "Workspace name is required (max 60 chars)" },
        { status: 400 }
      );
    }
    // Workspaces are invite-only: a company's member list is not something a
    // stranger should be able to walk into. There is no self-join path any
    // more (see /api/workspaces/join), so "public" would buy nothing but a
    // workspace that leaks its name and headcount — every workspace is born
    // private and grows through its invite code. Any `visibility` sent by a
    // client is deliberately ignored here.
    const vis = "private" as const;

    const db = await getDb();
    const userId = user._id.toString();

    const ws: WorkspaceDoc = {
      name: cleanName,
      description: typeof description === "string" ? description.trim() || null : null,
      avatarUrl: workspaceAvatar(cleanName),
      ownerId: userId,
      visibility: vis,
      inviteCode: newInviteCode(),
      memberCount: 1,
      createdAt: new Date(),
    };
    const result = await db.collection<WorkspaceDoc>("workspaces").insertOne(ws);
    const workspaceId = result.insertedId.toString();

    await db.collection<WorkspaceMemberDoc>("workspace_members").insertOne({
      workspaceId,
      userId,
      role: "owner",
      joinedAt: new Date(),
    });

    // Default channels so a new workspace is usable immediately. Everyone who
    // joins later is auto-enrolled in these because they are open channels.
    for (const channelName of ["general", "random"]) {
      const channel: ChatDoc = {
        type: "channel",
        workspaceId,
        visibility: "public",
        name: channelName,
        title: channelName,
        participants: [userId],
        memberCount: 1,
        maxSeq: 0,
        createdAt: new Date(),
      };
      const ins = await db.collection<ChatDoc>("chats").insertOne(channel);
      await db.collection<MemberDoc>("members").insertOne({
        chatId: ins.insertedId.toString(),
        userId,
        role: "owner",
        lastReadSeq: 0,
        joinedAt: new Date(),
      });
    }

    ws._id = result.insertedId;
    return NextResponse.json({ workspace: formatWorkspace(ws, "owner") });
  } catch (error) {
    console.error("Create workspace error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/workspaces — update name/description/visibility (owner/admin only)
export async function PATCH(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { workspaceId, name, description, visibility, regenerateInvite, avatarUrl } = await request.json();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const db = await getDb();
    const userId = user._id.toString();

    const ws = await findWorkspaceById(db, workspaceId);
    if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    const membership = await getWorkspaceMembership(db, workspaceId, userId);
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      return NextResponse.json(
        { error: "Only workspace admins can edit settings" },
        { status: 403 }
      );
    }

    const update: Partial<WorkspaceDoc> = {};
    if (typeof name === "string" && name.trim()) update.name = name.trim();
    if (typeof description === "string") update.description = description.trim() || null;
    if (visibility === "public" || visibility === "private") update.visibility = visibility;
    if (regenerateInvite === true) update.inviteCode = newInviteCode();
    if (typeof avatarUrl === "string" && /^(\/uploads\/|https?:\/\/)/.test(avatarUrl)) update.avatarUrl = avatarUrl;
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    await db.collection<WorkspaceDoc>("workspaces").updateOne({ _id: ws._id }, { $set: update });
    return NextResponse.json({
      workspace: formatWorkspace({ ...ws, ...update }, membership.role),
    });
  } catch (error) {
    console.error("Update workspace error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
