import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { verifyToken } from "@/lib/jwt-helper";
import { UserDoc } from "@/lib/db-types";

/**
 * POST /api/auth/switch — { token } from a previously signed-in account on
 * this device. Verifies it and makes it the active session cookie.
 */
export async function POST(request: Request) {
  try {
    const { token } = await request.json();
    if (typeof token !== "string" || !token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }
    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "This session has expired — please sign in again" }, { status: 401 });
    }
    const db = await getDb();
    const user = await db.collection<UserDoc>("users").findOne({ _id: new ObjectId(payload.userId) });
    if (!user || !user._id) {
      return NextResponse.json({ error: "Account no longer exists" }, { status: 404 });
    }

    const cookieStore = await cookies();
    cookieStore.set({
      name: "token",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return NextResponse.json({
      user: {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName || user.username,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    console.error("Switch account error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
