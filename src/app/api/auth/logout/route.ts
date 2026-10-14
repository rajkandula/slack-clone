import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { UserDoc } from "@/lib/db-types";
import { getAuthenticatedUser } from "@/lib/jwt-helper";
import { cookies } from "next/headers";

export async function POST() {
  try {
    const user = await getAuthenticatedUser();
    
    if (user && user._id) {
      const db = await getDb();
      // Set user status to offline
      await db.collection<UserDoc>("users").updateOne(
        { _id: user._id },
        { $set: { status: "offline", lastSeen: new Date() } }
      );
    }

    // Clear cookie
    const cookieStore = await cookies();
    cookieStore.delete("token");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
