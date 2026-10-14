/**
 * Workspace access — the single gate that turns WASP from a public social app
 * into a Slack-style product.
 *
 * The rule: you can only discover, DM, or view someone you share a workspace
 * with. Workspaces are invite-only, so membership is the whole access model.
 *
 * Deliberately scoped to *discovery and creation*. Existing conversations are
 * never revoked by these helpers — someone you already talk to does not vanish
 * because a workspace changed underneath you.
 */

import type { Db } from "mongodb";
import type { WorkspaceMemberDoc } from "./db-types";

/** Workspace ids this user belongs to. */
export async function getUserWorkspaceIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .collection<WorkspaceMemberDoc>("workspace_members")
    .find({ userId })
    .project<{ workspaceId: string }>({ workspaceId: 1 })
    .toArray();
  return rows.map((r) => r.workspaceId);
}

/**
 * Every user id that shares at least one workspace with this user.
 * Excludes the user themselves. Empty array = a solo account, which by design
 * can see nobody until they create a workspace or accept an invite.
 */
export async function getCoMemberIds(db: Db, userId: string): Promise<string[]> {
  const workspaceIds = await getUserWorkspaceIds(db, userId);
  if (workspaceIds.length === 0) return [];

  const rows = await db
    .collection<WorkspaceMemberDoc>("workspace_members")
    .find({ workspaceId: { $in: workspaceIds } })
    .project<{ userId: string }>({ userId: 1 })
    .toArray();

  return [...new Set(rows.map((r) => r.userId))].filter((id) => id !== userId);
}

/** True when both users belong to at least one workspace in common. */
export async function sharesWorkspace(db: Db, a: string, b: string): Promise<boolean> {
  const workspaceIds = await getUserWorkspaceIds(db, a);
  if (workspaceIds.length === 0) return false;
  const hit = await db
    .collection<WorkspaceMemberDoc>("workspace_members")
    .findOne({ workspaceId: { $in: workspaceIds }, userId: b });
  return !!hit;
}

/** Standard refusal for anything that requires a shared workspace. */
export const NOT_IN_YOUR_WORKSPACE =
  "You can only reach people in your workspace. Invite them, or ask for an invite.";
