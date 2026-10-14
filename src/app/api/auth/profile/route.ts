import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { UserDoc } from "@/lib/db-types";
import { getAuthenticatedUser, hashPassword } from "@/lib/jwt-helper";

export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user || !user._id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const currentUserId = user._id.toString();
    const { username, displayName, email, avatarUrl, bannerUrl, password, bio, gender, dateOfBirth, preferences, accountPrivate } = await request.json();

    const db = await getDb();
    const updateFields: Partial<UserDoc> = {};

    // 1. Username validation & check
    if (username !== undefined) {
      const cleanUsername = username.trim().toLowerCase();
      if (cleanUsername !== user.username) {
        if (cleanUsername.length < 3 || cleanUsername.length > 20) {
          return NextResponse.json(
            { error: "Username must be between 3 and 20 characters" },
            { status: 400 }
          );
        }
        // Check uniqueness
        const existingUser = await db.collection<UserDoc>("users").findOne({
          username: cleanUsername,
          _id: { $ne: user._id }
        });
        if (existingUser) {
          return NextResponse.json(
            { error: "Username is already taken" },
            { status: 409 }
          );
        }
        updateFields.username = cleanUsername;
      }
    }

    // 2. Email validation & check
    if (email !== undefined && email !== null) {
      const cleanEmail = email.trim().toLowerCase();
      if (cleanEmail !== user.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (cleanEmail !== "" && !emailRegex.test(cleanEmail)) {
          return NextResponse.json(
            { error: "Please provide a valid email address" },
            { status: 400 }
          );
        }
        // Check uniqueness if email is not empty
        updateFields.emailVerified = false; // new address must be re-confirmed
        if (cleanEmail !== "") {
          const existingEmail = await db.collection<UserDoc>("users").findOne({
            email: cleanEmail,
            _id: { $ne: user._id }
          });
          if (existingEmail) {
            return NextResponse.json(
              { error: "Email address is already registered" },
              { status: 409 }
            );
          }
        }
        updateFields.email = cleanEmail || null;
      }
    }

    // 3. Display Name validation
    if (displayName !== undefined && displayName !== null) {
      const cleanDisplayName = displayName.trim();
      if (cleanDisplayName.length === 0) {
        return NextResponse.json(
          { error: "Display name cannot be empty" },
          { status: 400 }
        );
      }
      updateFields.displayName = cleanDisplayName;
    }

    // 4. Avatar URL validation
    if (avatarUrl !== undefined && avatarUrl !== null) {
      updateFields.avatarUrl = avatarUrl;
    }

    // 5. Password update validation
    if (password !== undefined && password !== null && password !== "") {
      if (password.length < 6) {
        return NextResponse.json(
          { error: "Password must be at least 6 characters" },
          { status: 400 }
        );
      }
      updateFields.passwordHash = hashPassword(password);
    }

    // 6. Bio
    if (bio !== undefined) {
      updateFields.bio = (bio || "").trim().substring(0, 300);
    }

    // 7. Gender
    if (gender !== undefined) {
      updateFields.gender = gender || null;
    }

    // 8. Date of Birth
    if (dateOfBirth !== undefined) {
      updateFields.dateOfBirth = dateOfBirth || null;
    }

    // 8a2. Banner image (must be a URL we issued)
    if (typeof bannerUrl === "string" && /^(\/uploads\/|https?:\/\/)/.test(bannerUrl)) {
      updateFields.bannerUrl = bannerUrl;
    }

    // 8b. Account privacy
    if (typeof accountPrivate === "boolean") {
      updateFields.accountPrivate = accountPrivate;
      if (!accountPrivate) {
        // Going public: auto-accept every pending request.
        const pending = await db.collection("follow_requests").find({ targetId: currentUserId }).toArray();
        for (const r of pending) {
          await db.collection("follows").updateOne(
            { followerId: r.requesterId, followingId: currentUserId },
            { $setOnInsert: { followerId: r.requesterId, followingId: currentUserId, createdAt: new Date() } },
            { upsert: true }
          );
        }
        await db.collection("follow_requests").deleteMany({ targetId: currentUserId });
      }
    }

    // 9. Preferences (only known keys, validated)
    if (preferences && typeof preferences === "object") {
      const prefs: Record<string, unknown> = { ...(user.preferences || {}) };
      if (["public", "followers", "private"].includes(preferences.defaultPostVisibility)) {
        prefs.defaultPostVisibility = preferences.defaultPostVisibility;
      }
      updateFields.preferences = prefs;
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json({
        message: "No changes requested",
        user: {
          id: currentUserId,
          username: user.username,
          displayName: user.displayName,
          email: user.email,
          avatarUrl: user.avatarUrl,
          bio: user.bio || "",
          gender: user.gender || "",
          dateOfBirth: user.dateOfBirth || "",
          preferences: user.preferences || {},
          accountPrivate: !!user.accountPrivate,
          emailVerified: !!user.emailVerified,
          bannerUrl: user.bannerUrl || "",
        }
      });
    }

    await db.collection<UserDoc>("users").updateOne(
      { _id: user._id },
      { $set: updateFields }
    );

    // Fetch updated user
    const updatedUser = await db.collection<UserDoc>("users").findOne({ _id: user._id });

    return NextResponse.json({
      message: "Profile updated successfully",
      user: {
        id: currentUserId,
        username: updatedUser?.username || user.username,
        displayName: updatedUser?.displayName || user.displayName,
        email: updatedUser?.email || user.email,
        avatarUrl: updatedUser?.avatarUrl || user.avatarUrl,
        bio: updatedUser?.bio || "",
        gender: updatedUser?.gender || "",
        dateOfBirth: updatedUser?.dateOfBirth || "",
        preferences: updatedUser?.preferences || {},
        accountPrivate: !!updatedUser?.accountPrivate,
        emailVerified: !!updatedUser?.emailVerified,
        bannerUrl: updatedUser?.bannerUrl || "",
      }
    });
  } catch (error) {
    console.error("Profile update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
