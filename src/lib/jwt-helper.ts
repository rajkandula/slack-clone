import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getDb } from "./mongodb";
import { ObjectId } from "mongodb";
import { UserDoc } from "./db-types";
import { jwtSecret } from "./secret";



export function hashPassword(password: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

export function comparePassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signToken(payload: { userId: string; username: string }): string {
  return jwt.sign(payload, jwtSecret(), { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: string; username: string } | null {
  try {
    return jwt.verify(token, jwtSecret()) as { userId: string; username: string };
  } catch {
    return null;
  }
}

export async function getAuthenticatedUser(): Promise<UserDoc | null> {
  try {
    const cookieStore = await cookies();
    const tokenCookie = cookieStore.get("token");
    if (!tokenCookie) return null;

    const payload = verifyToken(tokenCookie.value);
    if (!payload) return null;

    const db = await getDb();
    const user = await db.collection<UserDoc>("users").findOne({
      _id: new ObjectId(payload.userId),
    });

    if (!user) return null;
    return user;
  } catch (error) {
    console.error("Auth helper error:", error);
    return null;
  }
}
