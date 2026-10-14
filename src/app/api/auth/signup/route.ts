import { sendMail, welcomeEmail } from "@/lib/mail";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { UserDoc } from "@/lib/db-types";
import { hashPassword, signToken } from "@/lib/jwt-helper";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  try {
    const { username, password, displayName, email } = await request.json();

    if (!username || !password || !displayName || !email) {
      return NextResponse.json(
        { error: "All fields (Full Name, Username, Email, Password) are required" },
        { status: 400 }
      );
    }

    const cleanUsername = username.trim().toLowerCase();
    if (cleanUsername.length < 3 || cleanUsername.length > 20) {
      return NextResponse.json(
        { error: "Username must be between 3 and 20 characters" },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return NextResponse.json(
        { error: "Please provide a valid email address" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const db = await getDb();
    
    // Check if username is already taken
    const existingUser = await db.collection<UserDoc>("users").findOne({
      username: cleanUsername,
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Username is already taken" },
        { status: 409 }
      );
    }

    // Check if email is already taken
    const existingEmail = await db.collection<UserDoc>("users").findOne({
      email: cleanEmail,
    });

    if (existingEmail) {
      return NextResponse.json(
        { error: "Email address is already registered" },
        { status: 409 }
      );
    }

    // Hash password and save new user
    const passwordHash = hashPassword(password);
    const avatarUrl = `https://api.dicebear.com/7.x/glass/svg?seed=${encodeURIComponent(cleanUsername)}&backgroundType=gradientLinear&backgroundColor=7c7cf0,6b8afd,5b8f8a,9a7bd0`;
    
    const newUser: UserDoc = {
      username: cleanUsername,
      passwordHash,
      displayName: displayName.trim(),
      email: cleanEmail,
      avatarUrl,
      status: "online",
      lastSeen: new Date(),
      createdAt: new Date(),
    };

    const result = await db.collection<UserDoc>("users").insertOne(newUser);
    const userId = result.insertedId.toString();

    // Welcome email — deliberately not awaited and never fatal: a mail outage
    // must not block someone from getting into the account they just created.
    void (async () => {
      try {
        const tpl = welcomeEmail(displayName.trim(), cleanUsername);
        await sendMail({ to: cleanEmail, ...tpl });
      } catch (err) {
        console.error("[signup] welcome email failed:", err);
      }
    })();

    // Create JWT token
    const token = signToken({ userId, username: cleanUsername });

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
        username: cleanUsername,
        avatarUrl,
        status: "online",
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
