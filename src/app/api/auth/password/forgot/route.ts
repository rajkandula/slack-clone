import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { UserDoc } from "@/lib/db-types";
import { MailError, passwordResetEmail, sendMail } from "@/lib/mail";
import { RESET_TTL_MINUTES, generateToken, isRateLimited, issueCode } from "@/lib/auth-codes";

function appOrigin(request: Request): string {
  // Prefer an explicit public URL in production; fall back to the request host.
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

/**
 * POST /api/auth/password/forgot — { email }
 * Emails a single-use reset link. Same response whether or not the account
 * exists, so it can't be used to enumerate addresses.
 */
export async function POST(request: Request) {
  const OK = NextResponse.json({
    ok: true,
    message: "If that email has a WASP account, a reset link is on its way.",
    expiresInMinutes: RESET_TTL_MINUTES,
  });

  try {
    const { email } = await request.json();
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
    }

    const db = await getDb();
    const user = await db.collection<UserDoc>("users").findOne({ email: cleanEmail });
    if (!user || !user._id) return OK;

    if (await isRateLimited(db, "password_reset", cleanEmail)) {
      return NextResponse.json(
        { error: "Too many reset emails requested. Please wait a few minutes." },
        { status: 429 }
      );
    }

    const token = generateToken();
    await issueCode(db, "password_reset", {
      email: cleanEmail,
      userId: user._id.toString(),
      ttlMinutes: RESET_TTL_MINUTES,
      value: token,
    });

    const link = `${appOrigin(request)}/reset-password?token=${encodeURIComponent(token)}`;
    const { subject, text } = passwordResetEmail(link, RESET_TTL_MINUTES);
    await sendMail({ to: cleanEmail, subject, text });

    return OK;
  } catch (err) {
    if (err instanceof MailError) {
      console.error("Reset mail failed:", err.message);
      return NextResponse.json(
        { error: "We couldn't send the email just now. Please try again in a moment." },
        { status: 502 }
      );
    }
    console.error("Forgot password error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
