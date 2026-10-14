import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/jwt-helper";

export async function GET() {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      user: {
        id: user._id.toString(),
        username: user.username,
        avatarUrl: user.avatarUrl,
        status: user.status,
        displayName: user.displayName || user.username,
        email: user.email || "",
        bio: user.bio || "",
        gender: user.gender || "",
        dateOfBirth: user.dateOfBirth || "",
        preferences: user.preferences || {},
        accountPrivate: !!user.accountPrivate,
        emailVerified: !!user.emailVerified,
        bannerUrl: user.bannerUrl || "",
        createdAt: user.createdAt,
        role: user.role || null,
      },
    });
  } catch (error) {
    console.error("Session fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
