import { getAuthenticatedUser } from "./jwt-helper";
import { UserDoc } from "./db-types";

/**
 * Company staff gate for /api/admin/*. Role lives on the user document and is
 * only ever set by hand (or by another admin) — there is no self-serve path
 * to it anywhere in the API surface.
 */
export async function requireAdmin(): Promise<UserDoc | null> {
  const user = await getAuthenticatedUser();
  if (!user || user.role !== "admin") return null;
  return user;
}
