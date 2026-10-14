import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { WorkspaceDoc } from "@/lib/db-types";
import { workspaceAvatar } from "@/lib/workspace-helpers";
import { getUserWorkspaceIds } from "@/lib/workspace-access";

// GET /api/workspaces/directory — the caller's OWN workspaces, searchable.
// This used to be a public browse-and-self-join listing, which is exactly what
// invite-only rules out: a workspace's existence, name and headcount are
// private to its members. The route and its response shape are kept so any UI
// still pointed at it degrades into "your workspaces" instead of breaking.
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = await getDb();
    const userId = user._id.toString();

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim();

    const memberOf = await getUserWorkspaceIds(db, userId);
    if (memberOf.length === 0) return NextResponse.json({ workspaces: [] });

    const filter: Record<string, unknown> = {
      _id: { $in: memberOf.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) },
    };
    if (q) filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

    const docs = await db
      .collection<WorkspaceDoc>("workspaces")
      .find(filter)
      .sort({ memberCount: -1, createdAt: -1 })
      .limit(50)
      .toArray();

    return NextResponse.json({
      workspaces: docs.map((ws) => ({
        id: ws._id!.toString(),
        name: ws.name,
        description: ws.description ?? null,
        avatarUrl: ws.avatarUrl ?? workspaceAvatar(ws.name),
        memberCount: ws.memberCount,
        // Everything listed here is a workspace the caller is already in.
        joined: true,
      })),
    });
  } catch (error) {
    console.error("Workspace directory error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
