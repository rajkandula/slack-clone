import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { jwtSecret } from "./secret";
import { Db, ObjectId } from "mongodb";

/* =========================================================================
   One-time codes and tokens (email OTP login, password reset, verification)
   -------------------------------------------------------------------------
   Rules that hold for every kind:
     · never stored in plaintext — HMAC-SHA256 keyed with JWT_SECRET, so a
       database leak alone cannot reverse a 6-digit code
     · short TTL, enforced both by query and by a Mongo TTL index
     · single use — consumed on success
     · limited verification attempts, then the code is burned
     · rate limited per email, so the mailbox can't be used as a weapon
   ========================================================================= */

export type CodeKind = "login_otp" | "password_reset" | "email_verify";

export interface AuthCodeDoc {
  _id?: ObjectId;
  kind: CodeKind;
  email: string;
  userId: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt?: Date | null;
  createdAt: Date;
}

export const OTP_TTL_MINUTES = 10;
export const RESET_TTL_MINUTES = 30;
export const VERIFY_TTL_MINUTES = 15;

const MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_SENDS = 3;



function hashCode(kind: CodeKind, value: string): string {
  return createHmac("sha256", jwtSecret()).update(`${kind}:${value}`).digest("hex");
}

function equalHashes(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** 6-digit numeric code, uniformly random (crypto, not Math.random). */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** High-entropy URL-safe token for reset links. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * True when this email has asked for too many codes recently. Checked before
 * sending so we neither spam the address nor burn Harakumo quota.
 */
export async function isRateLimited(db: Db, kind: CodeKind, email: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recent = await db
    .collection<AuthCodeDoc>("auth_codes")
    .countDocuments({ kind, email, createdAt: { $gte: since } });
  return recent >= RATE_LIMIT_MAX_SENDS;
}

/**
 * Issue a code. Any earlier unconsumed code of the same kind for this email is
 * invalidated first, so only the newest one in the inbox works.
 */
export async function issueCode(
  db: Db,
  kind: CodeKind,
  opts: { email: string; userId: string; ttlMinutes: number; value: string }
): Promise<void> {
  const codes = db.collection<AuthCodeDoc>("auth_codes");
  await codes.deleteMany({ kind, email: opts.email, consumedAt: { $exists: false } });
  await codes.insertOne({
    kind,
    email: opts.email,
    userId: opts.userId,
    codeHash: hashCode(kind, opts.value),
    expiresAt: new Date(Date.now() + opts.ttlMinutes * 60 * 1000),
    attempts: 0,
    createdAt: new Date(),
  });
}

export type ConsumeResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: "invalid" | "expired" | "too_many_attempts" };

/**
 * Verify and consume a code. `email` is optional: reset tokens are unguessable
 * on their own, while OTPs are scoped to the address that requested them.
 */
export async function consumeCode(
  db: Db,
  kind: CodeKind,
  value: string,
  email?: string
): Promise<ConsumeResult> {
  const codes = db.collection<AuthCodeDoc>("auth_codes");
  const query: Record<string, unknown> = { kind, consumedAt: { $exists: false } };
  if (email) query.email = email;

  const candidates = await codes.find(query).sort({ createdAt: -1 }).limit(5).toArray();
  if (candidates.length === 0) return { ok: false, reason: "invalid" };

  const wanted = hashCode(kind, value);
  const match = candidates.find((c) => equalHashes(c.codeHash, wanted));

  if (!match) {
    // Wrong code: count the attempt against the newest outstanding code and
    // burn it once the budget is gone, so guessing can't continue.
    const newest = candidates[0];
    const attempts = (newest.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await codes.deleteOne({ _id: newest._id });
      return { ok: false, reason: "too_many_attempts" };
    }
    await codes.updateOne({ _id: newest._id }, { $set: { attempts } });
    return { ok: false, reason: "invalid" };
  }

  if (match.expiresAt.getTime() < Date.now()) {
    await codes.deleteOne({ _id: match._id });
    return { ok: false, reason: "expired" };
  }

  await codes.deleteOne({ _id: match._id }); // single use
  return { ok: true, userId: match.userId, email: match.email };
}

/** Drop every outstanding code for a user (used after a password change). */
export async function revokeCodesForUser(db: Db, userId: string): Promise<void> {
  await db.collection<AuthCodeDoc>("auth_codes").deleteMany({ userId });
}
