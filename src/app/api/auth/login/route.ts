import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { UserDoc } from "@/lib/db-types";
import { comparePassword, signToken } from "@/lib/jwt-helper";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    const identifier = username.trim().toLowerCase();
    const db = await getDb();

    // People type whichever they remember, so accept either. An "@" can only
    // appear in an email — usernames are validated without it at signup.
    const user = await db.collection<UserDoc>("users").findOne(
      identifier.includes("@") ? { email: identifier } : { username: identifier }
    );

    if (!user || !user._id) {
      return NextResponse.json(
        { error: "Invalid login or password" },
        { status: 401 }
      );
    }

    // Compare password
    const isPasswordCorrect = comparePassword(password, user.passwordHash);
    if (!isPasswordCorrect) {
      return NextResponse.json(
        { error: "Invalid login or password" },
        { status: 401 }
      );
    }

    const userId = user._id.toString();

    // Update status to online
    await db.collection<UserDoc>("users").updateOne(
      { _id: user._id },
      { $set: { status: "online", lastSeen: new Date() } }
    );

    // Create JWT token
    const token = signToken({ userId, username: user.username });

    // Set cookie using next/headers cookies API
    const cookieStore = await cookies();
    cookieStore.set({
      name: "token",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return NextResponse.json({
      // Returned so the client can keep this account in its switcher list.
      token,
      user: {
        id: userId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        status: "online",
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
