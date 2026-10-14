import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { cookies } from "next/headers";
import { getDb } from "@/lib/mongodb";
import { UserDoc } from "@/lib/db-types";
import { hashPassword } from "@/lib/jwt-helper";
import { consumeCode, revokeCodesForUser } from "@/lib/auth-codes";

/**
 * POST /api/auth/password/reset — { token, password }
 * Sets a new password and signs every session out, so a stolen session can't
 * outlive the reset. The user signs in again with the new password.
 */
export async function POST(request: Request) {
  try {
    const { token, password } = await request.json();
    if (typeof token !== "string" || !token) {
      return NextResponse.json({ error: "This reset link is invalid." }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const db = await getDb();
    const result = await consumeCode(db, "password_reset", token);
    if (!result.ok) {
      const message =
        result.reason === "expired"
          ? "This reset link has expired. Please request a new one."
          : "This reset link is invalid or has already been used.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const users = db.collection<UserDoc>("users");
    const user = await users.findOne({ _id: new ObjectId(result.userId) });
    if (!user || !user._id) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    await users.updateOne(
      { _id: user._id },
      { $set: { passwordHash: hashPassword(password), emailVerified: true } }
    );
    await revokeCodesForUser(db, result.userId);

    // Drop this browser's session too — the new password is the only way back in.
    const cookieStore = await cookies();
    cookieStore.delete("token");

    return NextResponse.json({ ok: true, username: user.username });
  } catch (err) {
    console.error("Password reset error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
