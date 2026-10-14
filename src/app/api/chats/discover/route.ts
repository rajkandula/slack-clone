import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { ChatDoc, MemberDoc } from "@/lib/db-types";
import { getUserWorkspaceIds, NOT_IN_YOUR_WORKSPACE } from "@/lib/workspace-access";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /api/chats/discover?q=… — public groups and channels the caller can find,
// scoped to the workspaces they belong to. This used to list workspace-less
// personal groups to the whole world; discovery is now a workspace privilege,
// so a user with no workspace discovers nothing. Private groups (the default)
// never appear here either way.
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = await getDb();
    const userId = user._id.toString();

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() ?? "";

    const workspaceIds = await getUserWorkspaceIds(db, userId);
    if (workspaceIds.length === 0) return NextResponse.json({ groups: [] });

    const filter: Record<string, unknown> = {
      type: { $in: ["group", "channel"] },
      visibility: "public",
      workspaceId: { $in: workspaceIds },
    };
    if (q) filter.name = { $regex: escapeRegex(q), $options: "i" };

    const groups = await db
      .collection<ChatDoc>("chats")
      .find(filter)
      .sort({ memberCount: -1, createdAt: -1 })
      .limit(50)
      .toArray();

    return NextResponse.json({
      groups: groups.map((g) => ({
        id: g._id!.toString(),
        name: g.name || g.title || "Group",
        avatarUrl: g.avatarUrl ?? null,
        memberCount: g.memberCount || g.participants?.length || 0,
        joined: g.participants?.includes(userId) ?? false,
        createdAt: g.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Discover groups error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/chats/discover — join a public group/channel. Body: { chatId }
// Mirrors the GET gate: you can only join what you could discover, i.e. a
// public group inside one of your own workspaces.
export async function POST(request: Request) {
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

    const group = await db
      .collection<ChatDoc>("chats")
      .findOne({ _id: new ObjectId(chatId), type: { $in: ["group", "channel"] } });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Already inside: nothing to do, and nothing to re-check. Membership you
    // already have is never revoked by the workspace gate below.
    if (group.participants?.includes(userId)) {
      return NextResponse.json({ ok: true, chatId });
    }

    // Joining is discovery, so it needs a shared workspace.
    const workspaceIds = await getUserWorkspaceIds(db, userId);
    if (!group.workspaceId || !workspaceIds.includes(group.workspaceId)) {
      return NextResponse.json({ error: NOT_IN_YOUR_WORKSPACE }, { status: 403 });
    }
    if (group.visibility !== "public") {
      return NextResponse.json(
        { error: "This group is private — ask an admin to add you" },
        { status: 403 }
      );
    }

    await db.collection<ChatDoc>("chats").updateOne(
      { _id: group._id },
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

    return NextResponse.json({ ok: true, chatId });
  } catch (error) {
    console.error("Join group error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
