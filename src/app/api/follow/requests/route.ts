import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthenticatedUser } from "@/lib/jwt-helper";

// GET /api/follow/requests — incoming follow requests for me
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = await getDb();
  const me = user._id!.toString();

  const reqs = await db.collection("follow_requests").find({ targetId: me }).sort({ createdAt: -1 }).toArray();
  const users = reqs.length
    ? await db.collection("users").find({ _id: { $in: reqs.map((r) => new ObjectId(r.requesterId)) } }).toArray()
    : [];
  const byId = new Map(users.map((u) => [u._id.toString(), u]));

  return NextResponse.json({
    requests: reqs.map((r) => {
      const u = byId.get(r.requesterId);
      return {
        requesterId: r.requesterId,
        username: u?.username || "unknown",
        displayName: u?.displayName || u?.username || "Unknown",
        avatarUrl: u?.avatarUrl || "",
        createdAt: r.createdAt,
      };
    }),
  });
}

// POST /api/follow/requests — { requesterId, action: "accept" | "decline" }
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { requesterId, action } = await req.json();
  if (!requesterId || !["accept", "decline"].includes(action)) {
    return NextResponse.json({ error: "requesterId and action are required" }, { status: 400 });
  }
  const db = await getDb();
  const me = user._id!.toString();

  const pending = await db.collection("follow_requests").findOne({ requesterId, targetId: me });
  if (!pending) return NextResponse.json({ error: "No such request" }, { status: 404 });

  await db.collection("follow_requests").deleteOne({ _id: pending._id });
  // The request notification is resolved either way.
  await db.collection("notifications").updateMany(
    { userId: me, type: "follow_request", fromUserId: requesterId },
    { $set: { read: true, resolved: action } }
  );

  if (action === "accept") {
    await db.collection("follows").updateOne(
      { followerId: requesterId, followingId: me },
      { $setOnInsert: { followerId: requesterId, followingId: me, createdAt: new Date() } },
      { upsert: true }
    );
    await db.collection("notifications").insertOne({
      userId: requesterId,
      type: "follow_accepted",
      fromUserId: me,
      postId: null,
      text: null,
      read: false,
      createdAt: new Date(),
    });
  }
  return NextResponse.json({ ok: true, action });
}
