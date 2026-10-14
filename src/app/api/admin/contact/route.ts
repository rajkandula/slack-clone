import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/admin";

/** GET /api/admin/contact — the contact-form inbox, unhandled first. */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = await getDb();
  const messages = await db.collection("contact_messages")
    .find({}).sort({ handled: 1, createdAt: -1 }).limit(200).toArray();
  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m._id.toString(), name: m.name, email: m.email, message: m.message,
      handled: !!m.handled, createdAt: m.createdAt,
    })),
  });
}

/** PATCH /api/admin/contact — { id, handled } */
export async function PATCH(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, handled } = await request.json();
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const db = await getDb();
  await db.collection("contact_messages").updateOne({ _id: new ObjectId(id) }, { $set: { handled: !!handled } });
  return NextResponse.json({ ok: true });
}
