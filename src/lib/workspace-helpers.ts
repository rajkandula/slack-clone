import { randomBytes } from "crypto";
import { Db, ObjectId } from "mongodb";
import { ChatDoc, MemberDoc, WorkspaceDoc, WorkspaceMemberDoc } from "./db-types";

export function newInviteCode(): string {
  return randomBytes(4).toString("hex"); // 8 chars, e.g. "3fa9c21b"
}

export function workspaceAvatar(name: string): string {
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(
    name
  )}&backgroundType=gradientLinear&backgroundColor=7c7cf0,6b8afd,5b8f8a&fontWeight=600&chars=2`;
}

export async function getWorkspaceMembership(
  db: Db,
  workspaceId: string,
  userId: string
): Promise<WorkspaceMemberDoc | null> {
  return db
    .collection<WorkspaceMemberDoc>("workspace_members")
    .findOne({ workspaceId, userId });
}

/**
 * Adds a user to every public channel of a workspace they are not in yet.
 * Joining a workspace means "you get all its public channels and updates",
 * so this runs on workspace join and is the same fan-in used at channel
 * creation time (then in the other direction: all members into one channel).
 */
export async function joinAllPublicChannels(
  db: Db,
  workspaceId: string,
  userId: string
): Promise<number> {
  const channels = await db
    .collection<ChatDoc>("chats")
    .find({ workspaceId, visibility: "public" })
    .toArray();

  let joined = 0;
  for (const channel of channels) {
    const chatId = channel._id!.toString();
    if (channel.participants?.includes(userId)) continue;

    await db.collection<ChatDoc>("chats").updateOne(
      { _id: channel._id },
      { $addToSet: { participants: userId }, $inc: { memberCount: 1 } }
    );
    await db.collection<MemberDoc>("members").updateOne(
      { chatId, userId },
      {
        $setOnInsert: {
          chatId,
          userId,
          role: "member",
          lastReadSeq: 0,
          joinedAt: new Date(),
        },
      },
      { upsert: true }
    );
    joined++;
  }
  return joined;
}

/** Shape a workspace doc for API responses. `role` is the caller's role. */
export function formatWorkspace(
  ws: WorkspaceDoc,
  role: WorkspaceMemberDoc["role"] | null
) {
  return {
    id: ws._id!.toString(),
    name: ws.name,
    description: ws.description ?? null,
    avatarUrl: ws.avatarUrl ?? workspaceAvatar(ws.name),
    visibility: ws.visibility,
    memberCount: ws.memberCount,
    role,
    // The invite code is only for people already inside the workspace.
    inviteCode: role ? ws.inviteCode : undefined,
    createdAt: ws.createdAt.toISOString(),
  };
}

export async function findWorkspaceById(
  db: Db,
  id: string
): Promise<WorkspaceDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  return db.collection<WorkspaceDoc>("workspaces").findOne({ _id: new ObjectId(id) });
}
