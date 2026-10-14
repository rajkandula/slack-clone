import { cookies } from "next/headers";
import { signToken } from "./jwt-helper";
import { UserDoc } from "./db-types";

/**
 * Establish the signed-in session cookie. Shared by every entry point
 * (password login, signup, email-code login) so they can never drift apart.
 */
export async function establishSession(user: UserDoc): Promise<string> {
  const token = signToken({
    userId: user._id!.toString(),
    username: user.username,
  });

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

  return token;
}

/** The user shape the client expects back from any auth entry point. */
export function sessionUser(user: UserDoc) {
  return {
    id: user._id!.toString(),
    username: user.username,
    displayName: user.displayName || user.username,
    avatarUrl: user.avatarUrl,
    status: "online" as const,
  };
}
