import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { ObjectId } from "mongodb";
import { NOT_IN_YOUR_WORKSPACE, sharesWorkspace } from "@/lib/workspace-access";

/**
 * POST /api/follow — toggle follow for a public account, or send / cancel a
 * follow request for a private one. Body: { targetUserId }
 * Returns { following, requested }.
 *
 * Invite-only: a *new* follow (or follow request) needs a shared workspace.
 * The undo paths — unfollow, cancel a pending request — stay open whatever the
 * membership is now, so a relationship formed earlier can never get stuck.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { targetUserId } = await req.json();
  if (!targetUserId || !ObjectId.isValid(targetUserId)) {
    return NextResponse.json({ error: "targetUserId required" }, { status: 400 });
  }

  const db = await getDb();
  const followerId = user._id!.toString();
  if (followerId === targetUserId) {
    return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });
  }

  const target = await db.collection("users").findOne({ _id: new ObjectId(targetUserId) });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Already following → unfollow (same for public/private).
  const existing = await db.collection("follows").findOne({ followerId, followingId: targetUserId });
  if (existing) {
    await db.collection("follows").deleteOne({ _id: existing._id });
    return NextResponse.json({ following: false, requested: false });
  }

  // Checked only past the unfollow branch — removing never needs the gate.
  const canReach = await sharesWorkspace(db, followerId, targetUserId);

  if (target.accountPrivate) {
    // Private account: toggle a pending request instead.
    const pending = await db.collection("follow_requests").findOne({ requesterId: followerId, targetId: targetUserId });
    if (pending) {
      await db.collection("follow_requests").deleteOne({ _id: pending._id });
      await db.collection("notifications").deleteMany({ userId: targetUserId, type: "follow_request", fromUserId: followerId });
      return NextResponse.json({ following: false, requested: false });
    }
    if (!canReach) return NextResponse.json({ error: NOT_IN_YOUR_WORKSPACE }, { status: 403 });
    await db.collection("follow_requests").insertOne({ requesterId: followerId, targetId: targetUserId, createdAt: new Date() });
    await db.collection("notifications").insertOne({
      userId: targetUserId,
      type: "follow_request",
      fromUserId: followerId,
      postId: null,
      text: null,
      read: false,
      createdAt: new Date(),
    });
    return NextResponse.json({ following: false, requested: true });
  }

  if (!canReach) return NextResponse.json({ error: NOT_IN_YOUR_WORKSPACE }, { status: 403 });

  await db.collection("follows").insertOne({ followerId, followingId: targetUserId, createdAt: new Date() });
  await db.collection("notifications").insertOne({
    userId: targetUserId,
    type: "follow",
    fromUserId: followerId,
    postId: null,
    text: null,
    read: false,
    createdAt: new Date(),
  });
  return NextResponse.json({ following: true, requested: false });
}

// GET /api/follow?userId=xxx — follow status & counts (+ requested, accountPrivate)
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const targetUserId = req.nextUrl.searchParams.get("userId") || user._id!.toString();
  const db = await getDb();
  const myId = user._id!.toString();

  // Follower counts are social-graph data about a specific person, so they
  // follow the same rule as everything else: your workspace only.
  if (targetUserId !== myId && !(await sharesWorkspace(db, myId, targetUserId))) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const [followers, following, isFollowing, requested, pendingIncoming] = await Promise.all([
    db.collection("follows").countDocuments({ followingId: targetUserId }),
    db.collection("follows").countDocuments({ followerId: targetUserId }),
    targetUserId !== myId ? db.collection("follows").findOne({ followerId: myId, followingId: targetUserId }) : null,
    targetUserId !== myId ? db.collection("follow_requests").findOne({ requesterId: myId, targetId: targetUserId }) : null,
    targetUserId === myId ? db.collection("follow_requests").countDocuments({ targetId: myId }) : 0,
  ]);

  return NextResponse.json({
    followers,
    following,
    isFollowing: !!isFollowing,
    requested: !!requested,
    pendingRequests: pendingIncoming,
  });
}
