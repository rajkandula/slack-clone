import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { ObjectId } from "mongodb";

// GET /api/notifications
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = await getDb();
  const userId = user._id!.toString();

  const notifs = await db.collection("notifications")
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

  // Get fromUser info
  const fromUserIds = [...new Set(notifs.map(n => n.fromUserId).filter(Boolean))];
  const fromUsers = fromUserIds.length > 0
    ? await db.collection("users")
        .find({ _id: { $in: fromUserIds.map(id => new ObjectId(id)) } })
        .toArray()
    : [];
  const userMap = Object.fromEntries(
    fromUsers.map(u => [u._id.toString(), {
      id: u._id.toString(),
      username: u.username || "",
      displayName: u.displayName || u.username || "",
      avatarUrl: u.avatarUrl || "",
    }])
  );

  // Mark all as read
  await db.collection("notifications").updateMany(
    { userId, read: false },
    { $set: { read: true } }
  );

  const result = notifs.map(n => ({
    id: n._id.toString(),
    type: n.type,
    fromUser: n.fromUserId ? userMap[n.fromUserId] || null : null,
    postId: n.postId || null,
    text: n.text || null,
    read: n.read,
    resolved: n.resolved || null,
    createdAt: n.createdAt,
  }));

  return NextResponse.json(result);
}
