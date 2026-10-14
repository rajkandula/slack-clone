import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { sharesWorkspace } from "@/lib/workspace-access";

/**
 * GET /api/users?username=… — a user's public profile card, with the
 * viewer's relationship. Private accounts expose only name/avatar/bio and
 * counts until the viewer is an accepted follower (`canViewContent`).
 */
export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const username = (req.nextUrl.searchParams.get("username") || "").trim().toLowerCase();
  if (!username) return NextResponse.json({ error: "username is required" }, { status: 400 });

  const db = await getDb();
  const target = await db.collection("users").findOne({ username });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const me = user._id!.toString();
  const targetId = target._id.toString();
  const isSelf = targetId === me;

  // Profiles are workspace-scoped. Your own profile is always visible; anyone
  // else has to be a workspace mate. 404 rather than 403 on purpose — a refusal
  // that says "exists, but not for you" still leaks that the account is real.
  if (!isSelf && !(await sharesWorkspace(db, me, targetId))) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const [followers, following, isFollowing, requested, postCount] = await Promise.all([
    db.collection("follows").countDocuments({ followingId: targetId }),
    db.collection("follows").countDocuments({ followerId: targetId }),
    isSelf ? null : db.collection("follows").findOne({ followerId: me, followingId: targetId }),
    isSelf ? null : db.collection("follow_requests").findOne({ requesterId: me, targetId }),
    db.collection("posts").countDocuments({ authorId: targetId, deletedAt: { $exists: false } }),
  ]);

  const accountPrivate = !!target.accountPrivate;
  const canViewContent = isSelf || !accountPrivate || !!isFollowing;

  return NextResponse.json({
    user: {
      id: targetId,
      username: target.username,
      displayName: target.displayName || target.username,
      avatarUrl: target.avatarUrl || "",
      bannerUrl: target.bannerUrl || "",
      bio: target.bio || "",
      accountPrivate,
      createdAt: target.createdAt,
      followers,
      following,
      postCount,
    },
    relationship: { isSelf, isFollowing: !!isFollowing, requested: !!requested, canViewContent },
  });
}
