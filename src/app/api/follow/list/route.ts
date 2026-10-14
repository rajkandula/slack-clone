import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getCoMemberIds, sharesWorkspace } from "@/lib/workspace-access";

/**
 * GET /api/follow/list?userId=…&type=followers|following
 * Who follows a user / who they follow, as user cards with the viewer's own
 * relationship to each. Private accounts only reveal their lists to accepted
 * followers (or themselves) — same gate as their posts.
 *
 * Someone else's list is filtered to people the *viewer* shares a workspace
 * with, so a shared contact can't be used to enumerate strangers. Your own
 * lists always come back whole.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const targetUserId = req.nextUrl.searchParams.get("userId") || "";
  const type = req.nextUrl.searchParams.get("type");
  if (!ObjectId.isValid(targetUserId) || (type !== "followers" && type !== "following")) {
    return NextResponse.json({ error: "userId and type=followers|following are required" }, { status: 400 });
  }

  const db = await getDb();
  const me = user._id!.toString();

  const target = await db.collection("users").findOne({ _id: new ObjectId(targetUserId) });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  // Answer identically for "no such account" and "exists but not in your
  // workspace" — otherwise the status code itself confirms who is registered.
  if (targetUserId !== me && !(await sharesWorkspace(db, me, targetUserId))) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.accountPrivate && targetUserId !== me) {
    const iFollow = await db.collection("follows").findOne({ followerId: me, followingId: targetUserId });
    if (!iFollow) return NextResponse.json({ error: "This account is private" }, { status: 403 });
  }

  const edges = await db.collection("follows")
    .find(type === "followers" ? { followingId: targetUserId } : { followerId: targetUserId })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
  let ids = edges.map((e) => (type === "followers" ? e.followerId : e.followingId)).filter((id) => ObjectId.isValid(id));

  if (targetUserId !== me) {
    const coMembers = new Set(await getCoMemberIds(db, me));
    // Keep myself in the list even when it's someone else's — I'm not a
    // discovery leak, and dropping me would misreport their followers.
    ids = ids.filter((id) => id === me || coMembers.has(id));
  }

  const users = ids.length
    ? await db.collection("users").find({ _id: { $in: ids.map((i) => new ObjectId(i)) } }).toArray()
    : [];
  const byId = new Map(users.map((u) => [u._id.toString(), u]));

  // Viewer's relationship to each listed user.
  const [myFollows, myRequests] = await Promise.all([
    db.collection("follows").find({ followerId: me, followingId: { $in: ids } }).toArray(),
    db.collection("follow_requests").find({ requesterId: me, targetId: { $in: ids } }).toArray(),
  ]);
  const following = new Set(myFollows.map((f) => f.followingId));
  const requested = new Set(myRequests.map((r) => r.targetId));

  return NextResponse.json({
    users: ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((u) => ({
        id: u!._id.toString(),
        username: u!.username || "",
        displayName: u!.displayName || u!.username || "",
        avatarUrl: u!.avatarUrl || "",
        accountPrivate: !!u!.accountPrivate,
        isSelf: u!._id.toString() === me,
        isFollowing: following.has(u!._id.toString()),
        requested: requested.has(u!._id.toString()),
      })),
  });
}
