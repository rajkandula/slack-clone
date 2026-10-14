import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getCoMemberIds } from "@/lib/workspace-access";
import { ObjectId } from "mongodb";

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "8"), 50);

  const db = await getDb();

  // People search is workspace-scoped: you can only find someone you already
  // share a workspace with. No workspace means nobody to find, so we skip the
  // query entirely rather than building an `$in: []` filter.
  const coMemberIds = await getCoMemberIds(db, user._id!.toString());
  if (coMemberIds.length === 0) return NextResponse.json({ users: [] });

  const filter: Record<string, unknown> = {
    _id: { $in: coMemberIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) },
  };

  if (q.length > 0) {
    const regex = new RegExp(`^${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    filter.$or = [{ username: regex }, { displayName: regex }];
  }

  const results = await db
    .collection("users")
    .find(filter, {
      projection: {
        _id: 1,
        username: 1,
        displayName: 1,
        avatarUrl: 1,
        accountPrivate: 1,
      },
    })
    .limit(limit)
    .toArray();

  // Which of these do I already follow? Lets the UI show the real state.
  const ids = results.map((u) => u._id.toString());
  const follows = ids.length
    ? await db.collection("follows").find({ followerId: user._id!.toString(), followingId: { $in: ids } }).toArray()
    : [];
  const following = new Set(follows.map((f) => f.followingId));
  const reqs = ids.length
    ? await db.collection("follow_requests").find({ requesterId: user._id!.toString(), targetId: { $in: ids } }).toArray()
    : [];
  const requested = new Set(reqs.map((r) => r.targetId));

  const users = results.map((u) => ({
    id: u._id.toString(),
    username: u.username || "",
    displayName: u.displayName || "",
    avatarUrl: u.avatarUrl || "",
    accountPrivate: !!u.accountPrivate,
    isFollowing: following.has(u._id.toString()),
    requested: requested.has(u._id.toString()),
  }));

  return NextResponse.json({ users });
}
