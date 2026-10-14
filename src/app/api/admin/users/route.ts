import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/admin";
import { UserDoc } from "@/lib/db-types";

/** GET /api/admin/users?q= — every account, newest first. */
export async function GET(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const q = new URL(request.url).searchParams.get("q")?.trim();
  const db = await getDb();
  const filter = q
    ? { $or: [{ username: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }, { displayName: { $regex: q, $options: "i" } }] }
    : {};
  const users = await db.collection<UserDoc>("users")
    .find(filter)
    .project({ passwordHash: 0, twoFactor: 0 })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();

  return NextResponse.json({
    users: users.map((u) => ({
      id: u._id!.toString(),
      username: u.username,
      displayName: u.displayName || "",
      email: u.email || "",
      role: u.role || null,
      accountPrivate: !!u.accountPrivate,
      emailVerified: !!u.emailVerified,
      createdAt: u.createdAt,
      lastSeen: u.lastSeen || null,
    })),
  });
}
