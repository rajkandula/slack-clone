import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { getDb } from "@/lib/mongodb";
import { pushPublicKey, PushSubscriptionDoc } from "@/lib/push";

/** GET /api/push — the VAPID public key the browser subscribes with. */
export async function GET() {
  const publicKey = pushPublicKey();
  return NextResponse.json({ publicKey, enabled: !!publicKey });
}

/** POST /api/push — save this browser's push subscription. */
export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user || !user._id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subscription } = await request.json();
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: "A push subscription is required" }, { status: 400 });
  }
  if (typeof subscription.endpoint !== "string" || !/^https:\/\//.test(subscription.endpoint)) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  const db = await getDb();
  await db.collection<PushSubscriptionDoc>("push_subscriptions").updateOne(
    { endpoint: subscription.endpoint },
    {
      $set: {
        userId: user._id.toString(),
        keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        userAgent: request.headers.get("user-agent"),
      },
      $setOnInsert: { endpoint: subscription.endpoint, createdAt: new Date() },
    },
    { upsert: true }
  );
  return NextResponse.json({ ok: true });
}

/** DELETE /api/push — remove this browser's subscription. */
export async function DELETE(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user || !user._id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  const db = await getDb();
  await db.collection("push_subscriptions").deleteOne({ endpoint, userId: user._id.toString() });
  return NextResponse.json({ ok: true });
}
