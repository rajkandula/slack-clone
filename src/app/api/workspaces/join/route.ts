import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { WorkspaceDoc, WorkspaceMemberDoc } from "@/lib/db-types";
import { formatWorkspace, joinAllPublicChannels } from "@/lib/workspace-helpers";

// POST /api/workspaces/join — body: { inviteCode }
// An invite code is the ONLY way in. The old self-join-by-workspaceId path is
// gone: workspaces are invite-only, so knowing (or guessing) a workspace id
// must never be enough to walk into a company's conversations.
// Joining a workspace enrolls the user in every public channel so they get
// all of its conversations and updates immediately.
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { inviteCode } = await request.json();
    const db = await getDb();
    const userId = user._id.toString();

    const code = typeof inviteCode === "string" ? inviteCode.trim() : "";
    if (!code) {
      return NextResponse.json(
        { error: "An invite code is required to join a workspace" },
        { status: 400 }
      );
    }

    const ws = await db
      .collection<WorkspaceDoc>("workspaces")
      .findOne({ inviteCode: code.toLowerCase() });
    if (!ws) {
      return NextResponse.json({ error: "Invalid invite code" }, { status: 404 });
    }

    const wsId = ws._id!.toString();

    const existing = await db
      .collection<WorkspaceMemberDoc>("workspace_members")
      .findOne({ workspaceId: wsId, userId });
    if (existing) {
      return NextResponse.json({
        workspace: formatWorkspace(ws, existing.role),
        alreadyMember: true,
      });
    }

    await db.collection<WorkspaceMemberDoc>("workspace_members").insertOne({
      workspaceId: wsId,
      userId,
      role: "member",
      joinedAt: new Date(),
    });
    await db
      .collection<WorkspaceDoc>("workspaces")
      .updateOne({ _id: ws._id }, { $inc: { memberCount: 1 } });

    const channelsJoined = await joinAllPublicChannels(db, wsId, userId);

    return NextResponse.json({
      workspace: formatWorkspace({ ...ws, memberCount: ws.memberCount + 1 }, "member"),
      channelsJoined,
    });
  } catch (error) {
    console.error("Join workspace error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
