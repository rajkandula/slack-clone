import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { ChatDoc, MemberDoc, UserDoc, WorkspaceDoc, WorkspaceMemberDoc } from "@/lib/db-types";
import { findWorkspaceById, getWorkspaceMembership } from "@/lib/workspace-helpers";

// GET /api/workspaces/members?workspaceId=… — members with profile info
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });

    const db = await getDb();
    const me = user._id.toString();
    const myMembership = await getWorkspaceMembership(db, workspaceId, me);
    if (!myMembership) return NextResponse.json({ error: "Not a member of this workspace" }, { status: 403 });

    const members = await db.collection<WorkspaceMemberDoc>("workspace_members").find({ workspaceId }).sort({ joinedAt: 1 }).toArray();
    const users = await db.collection<UserDoc>("users")
      .find({ _id: { $in: members.map((m) => new ObjectId(m.userId)) } })
      .toArray();
    const byId = new Map(users.map((u) => [u._id!.toString(), u]));
    const rank = { owner: 0, admin: 1, member: 2 } as const;

    return NextResponse.json({
      role: myMembership.role,
      members: members
        .map((m) => {
          const u = byId.get(m.userId);
          return {
            userId: m.userId,
            username: u?.username || "unknown",
            displayName: u?.displayName || u?.username || "Unknown",
            avatarUrl: u?.avatarUrl || "",
            status: u?.status || "offline",
            role: m.role,
            joinedAt: m.joinedAt,
            isSelf: m.userId === me,
          };
        })
        .sort((a, b) => rank[a.role] - rank[b.role] || a.username.localeCompare(b.username)),
    });
  } catch (error) {
    console.error("Workspace members error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/workspaces/members — change role. Body: { workspaceId, userId, role: "admin"|"member" } (owner only)
export async function PATCH(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { workspaceId, userId: targetId, role } = await request.json();
    if (!workspaceId || !targetId || !["admin", "member"].includes(role)) {
      return NextResponse.json({ error: "workspaceId, userId and role are required" }, { status: 400 });
    }
    const db = await getDb();
    const me = user._id.toString();
    const mine = await getWorkspaceMembership(db, workspaceId, me);
    if (!mine || mine.role !== "owner") {
      return NextResponse.json({ error: "Only the workspace owner can change roles" }, { status: 403 });
    }
    const target = await getWorkspaceMembership(db, workspaceId, targetId);
    if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    if (target.role === "owner") return NextResponse.json({ error: "Cannot change the owner's role" }, { status: 400 });

    await db.collection<WorkspaceMemberDoc>("workspace_members").updateOne({ workspaceId, userId: targetId }, { $set: { role } });
    return NextResponse.json({ ok: true, role });
  } catch (error) {
    console.error("Workspace role error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/workspaces/members?workspaceId=…&userId=… — leave (self) or remove (admin/owner).
// Removing someone also drops them from every channel in the workspace.
export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const targetId = searchParams.get("userId");
    if (!workspaceId || !targetId) return NextResponse.json({ error: "workspaceId and userId are required" }, { status: 400 });

    const db = await getDb();
    const me = user._id.toString();
    const ws = await findWorkspaceById(db, workspaceId);
    if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    const mine = await getWorkspaceMembership(db, workspaceId, me);
    if (!mine) return NextResponse.json({ error: "Not a member of this workspace" }, { status: 403 });
    const target = await getWorkspaceMembership(db, workspaceId, targetId);
    if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    const isSelf = targetId === me;
    if (!isSelf && mine.role !== "owner" && mine.role !== "admin") {
      return NextResponse.json({ error: "Only admins can remove members" }, { status: 403 });
    }
    if (target.role === "owner") {
      return NextResponse.json({ error: "The owner cannot leave or be removed. Transfer ownership first." }, { status: 400 });
    }
    if (!isSelf && target.role === "admin" && mine.role !== "owner") {
      return NextResponse.json({ error: "Only the owner can remove an admin" }, { status: 403 });
    }

    await db.collection<WorkspaceMemberDoc>("workspace_members").deleteOne({ workspaceId, userId: targetId });
    await db.collection<WorkspaceDoc>("workspaces").updateOne({ _id: ws._id }, { $inc: { memberCount: -1 } });

    // Drop them from every channel of this workspace.
    const channels = await db.collection<ChatDoc>("chats").find({ workspaceId, participants: targetId }).toArray();
    for (const c of channels) {
      await db.collection<ChatDoc>("chats").updateOne({ _id: c._id }, { $pull: { participants: targetId }, $inc: { memberCount: -1 } });
      await db.collection<MemberDoc>("members").deleteOne({ chatId: c._id!.toString(), userId: targetId });
    }

    return NextResponse.json({ ok: true, left: isSelf });
  } catch (error) {
    console.error("Workspace member remove error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
