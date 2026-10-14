import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { UserDoc } from "@/lib/db-types";
import { MailError, otpLoginEmail, sendMail } from "@/lib/mail";
import { OTP_TTL_MINUTES, generateOtp, isRateLimited, issueCode } from "@/lib/auth-codes";

/**
 * POST /api/auth/otp/request — { email }
 * Emails a one-time sign-in code.
 *
 * Always answers the same way whether or not the address has an account, so
 * this endpoint can't be used to discover who is registered.
 */
export async function POST(request: Request) {
  const OK = NextResponse.json({
    ok: true,
    message: "If that email has a WASP account, a sign-in code is on its way.",
    expiresInMinutes: OTP_TTL_MINUTES,
  });

  try {
    const { email } = await request.json();
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
    }

    const db = await getDb();
    const user = await db.collection<UserDoc>("users").findOne({ email: cleanEmail });
    if (!user || !user._id) return OK; // silent: no account, no hint

    if (await isRateLimited(db, "login_otp", cleanEmail)) {
      return NextResponse.json(
        { error: "Too many codes requested. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    const code = generateOtp();
    await issueCode(db, "login_otp", {
      email: cleanEmail,
      userId: user._id.toString(),
      ttlMinutes: OTP_TTL_MINUTES,
      value: code,
    });

    const { subject, text } = otpLoginEmail(code, OTP_TTL_MINUTES);
    await sendMail({ to: cleanEmail, subject, text });

    return OK;
  } catch (err) {
    if (err instanceof MailError) {
      console.error("OTP mail failed:", err.message);
      return NextResponse.json(
        { error: "We couldn't send the email just now. Please try again in a moment." },
        { status: 502 }
      );
    }
    console.error("OTP request error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
