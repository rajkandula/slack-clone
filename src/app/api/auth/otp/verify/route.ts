import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { UserDoc } from "@/lib/db-types";
import { consumeCode } from "@/lib/auth-codes";
import { establishSession, sessionUser } from "@/lib/session";

/** POST /api/auth/otp/verify — { email, code } → signs the user in. */
export async function POST(request: Request) {
  try {
    const { email, code } = await request.json();
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const cleanCode = typeof code === "string" ? code.replace(/\D/g, "") : "";
    if (!cleanEmail || cleanCode.length !== 6) {
      return NextResponse.json({ error: "Enter the 6-digit code from your email" }, { status: 400 });
    }

    const db = await getDb();
    const result = await consumeCode(db, "login_otp", cleanCode, cleanEmail);

    if (!result.ok) {
      const message =
        result.reason === "expired"
          ? "That code has expired — request a new one."
          : result.reason === "too_many_attempts"
            ? "Too many incorrect attempts. Request a new code."
            : "That code isn't right. Check it and try again.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const users = db.collection<UserDoc>("users");
    const user = await users.findOne({ _id: new ObjectId(result.userId) });
    if (!user || !user._id) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Signing in with a code proves control of the mailbox.
    await users.updateOne(
      { _id: user._id },
      { $set: { emailVerified: true, status: "online", lastSeen: new Date() } }
    );

    const token = await establishSession(user);
    return NextResponse.json({ token, user: sessionUser(user) });
  } catch (err) {
    console.error("OTP verify error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
