import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { UserDoc } from "@/lib/db-types";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { MailError, emailVerifyEmail, sendMail } from "@/lib/mail";
import { VERIFY_TTL_MINUTES, consumeCode, generateOtp, isRateLimited, issueCode } from "@/lib/auth-codes";

/**
 * POST /api/auth/email/verify
 *   { action: "request" }        → emails a verification code
 *   { action: "confirm", code }  → marks the address verified
 * Both require a signed-in session: this confirms the address on your own
 * account, so there is nothing to enumerate.
 */
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const email = (user.email || "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { error: "Add an email address to your account first." },
        { status: 400 }
      );
    }

    const { action, code } = await request.json();
    const db = await getDb();
    const userId = user._id.toString();

    if (action === "request") {
      if (user.emailVerified) {
        return NextResponse.json({ ok: true, alreadyVerified: true });
      }
      if (await isRateLimited(db, "email_verify", email)) {
        return NextResponse.json(
          { error: "Too many codes requested. Please wait a few minutes." },
          { status: 429 }
        );
      }

      const otp = generateOtp();
      await issueCode(db, "email_verify", {
        email,
        userId,
        ttlMinutes: VERIFY_TTL_MINUTES,
        value: otp,
      });

      const { subject, text } = emailVerifyEmail(otp, VERIFY_TTL_MINUTES);
      await sendMail({ to: email, subject, text });

      return NextResponse.json({ ok: true, sentTo: email, expiresInMinutes: VERIFY_TTL_MINUTES });
    }

    if (action === "confirm") {
      const cleanCode = typeof code === "string" ? code.replace(/\D/g, "") : "";
      if (cleanCode.length !== 6) {
        return NextResponse.json({ error: "Enter the 6-digit code from your email" }, { status: 400 });
      }

      const result = await consumeCode(db, "email_verify", cleanCode, email);
      if (!result.ok) {
        const message =
          result.reason === "expired"
            ? "That code has expired — request a new one."
            : result.reason === "too_many_attempts"
              ? "Too many incorrect attempts. Request a new code."
              : "That code isn't right. Check it and try again.";
        return NextResponse.json({ error: message }, { status: 400 });
      }
      if (result.userId !== userId) {
        return NextResponse.json({ error: "That code isn't for this account." }, { status: 400 });
      }

      await db.collection<UserDoc>("users").updateOne(
        { _id: user._id },
        { $set: { emailVerified: true } }
      );
      return NextResponse.json({ ok: true, verified: true });
    }

    return NextResponse.json({ error: 'action must be "request" or "confirm"' }, { status: 400 });
  } catch (err) {
    if (err instanceof MailError) {
      console.error("Verify mail failed:", err.message);
      return NextResponse.json(
        { error: "We couldn't send the email just now. Please try again in a moment." },
        { status: 502 }
      );
    }
    console.error("Email verify error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
