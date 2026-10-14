import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/admin";

/** GET /api/admin/overview — the company dashboard numbers. */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = await getDb();
  const now = Date.now();
  const dayAgo = new Date(now - 86_400_000);
  const since14 = new Date(now - 14 * 86_400_000);

  const [users, messages, posts, chats, workspaces, calls, pushSubs, contactsOpen,
         activeNow, newToday, messagesToday, signupSeries] = await Promise.all([
    db.collection("users").countDocuments(),
    db.collection("messages").countDocuments(),
    db.collection("posts").countDocuments(),
    db.collection("chats").countDocuments(),
    db.collection("workspaces").countDocuments(),
    db.collection("calls").countDocuments(),
    db.collection("push_subscriptions").countDocuments(),
    db.collection("contact_messages").countDocuments({ handled: false }),
    db.collection("users").countDocuments({ lastSeen: { $gt: new Date(now - 300_000) } }),
    db.collection("users").countDocuments({ createdAt: { $gt: dayAgo } }),
    db.collection("messages").countDocuments({ createdAt: { $gt: dayAgo } }),
    db.collection("users").aggregate([
      { $match: { createdAt: { $gte: since14 } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
  ]);

  return NextResponse.json({
    totals: { users, messages, posts, chats, workspaces, calls, pushSubs },
    today: { newUsers: newToday, messages: messagesToday, activeNow },
    inbox: { open: contactsOpen },
    signups14d: signupSeries.map((d) => ({ day: d._id, count: d.n })),
  });
}
