import webpush from "web-push";
import { Db, ObjectId } from "mongodb";
import { UserDoc } from "./db-types";

/**
 * Web Push delivery — how WASP reaches a phone when the app is closed.
 *
 * Subscriptions live in `push_subscriptions` (one per browser install). A user
 * counts as "active" while their SSE loop is refreshing lastSeen every 1.5s;
 * pushes only go to people the realtime stream can't reach, so an open tab
 * never buzzes the phone in your pocket for a message you're looking at.
 */

export interface PushSubscriptionDoc {
  _id?: ObjectId;
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
  createdAt: Date;
}

let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!pub || !priv) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export function pushPublicKey(): string | null {
  return ensureConfigured() ? process.env.VAPID_PUBLIC_KEY! : null;
}

/** Is this user's realtime stream alive right now? */
export function isUserActive(user: Pick<UserDoc, "status" | "lastSeen"> | null): boolean {
  if (!user) return false;
  if (user.status !== "online" || !user.lastSeen) return false;
  return Date.now() - new Date(user.lastSeen).getTime() < 15_000;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Same tag replaces the previous notification instead of stacking. */
  tag?: string;
}

/**
 * Send to every device a user has subscribed. Dead subscriptions (uninstalls,
 * expired endpoints) come back 404/410 and are pruned on the spot.
 */
export async function sendPushToUser(db: Db, userId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;

  const subs = await db
    .collection<PushSubscriptionDoc>("push_subscriptions")
    .find({ userId })
    .toArray();
  if (subs.length === 0) return 0;

  let delivered = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
          { TTL: 3600, urgency: "high" }
        );
        delivered++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.collection("push_subscriptions").deleteOne({ _id: sub._id });
        } else {
          console.error("Push delivery failed:", status, sub.endpoint.slice(0, 60));
        }
      }
    })
  );
  return delivered;
}

/**
 * Push to every chat participant whose realtime stream is gone, at most once
 * per chat per throttle window so a busy group can't buzz someone forty times.
 */
export async function pushToInactiveParticipants(
  db: Db,
  chatId: string,
  recipientIds: string[],
  payload: PushPayload,
  throttleMs = 120_000
): Promise<void> {
  if (!ensureConfigured() || recipientIds.length === 0) return;

  const users = await db
    .collection<UserDoc>("users")
    .find({ _id: { $in: recipientIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id)) } })
    .project<{ _id: ObjectId; status?: string; lastSeen?: Date }>({ status: 1, lastSeen: 1 })
    .toArray();

  const inactive = users.filter((u) => !isUserActive(u as UserDoc)).map((u) => u._id.toString());
  if (inactive.length === 0) return;

  const cutoff = new Date(Date.now() - throttleMs);
  for (const userId of inactive) {
    // The members doc doubles as the per-(user, chat) throttle state.
    const res = await db.collection("members").updateOne(
      { chatId, userId, $or: [{ lastPushAt: { $lt: cutoff } }, { lastPushAt: { $exists: false } }] },
      { $set: { lastPushAt: new Date() } }
    );
    if (res.modifiedCount === 0) continue; // throttled (or not a member)
    await sendPushToUser(db, userId, payload);
  }
}
