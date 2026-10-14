import { ObjectId } from "mongodb";

export interface UserDoc {
  _id?: ObjectId;
  phone?: string | null;
  email?: string | null;
  username: string;
  passwordHash: string;
  /** Set once the address is confirmed by an emailed code (or an OTP sign-in). */
  emailVerified?: boolean;
  displayName?: string | null;
  bio?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  /** Profile banner image URL. */
  bannerUrl?: string | null;
  /** Private accounts gate their profile/posts behind accepted follows. */
  accountPrivate?: boolean;
  /** Company staff: "admin" unlocks /admin and the /api/admin endpoints. */
  role?: "admin" | null;
  preferences?: {
    defaultPostVisibility?: "public" | "followers" | "private";
  };
  photos?: Array<{
    r2Key: string;
    thumbR2Key: string;
    addedAt: Date;
  }>;
  privacy?: {
    lastSeen: string;
    phone: string;
    photo: string;
    bio: string;
    calls: string;
    groupAdd: string;
    forwardTag: string;
  };
  premium?: {
    tier: string;
    expiresAt: Date | null;
  };
  twoFactor?: {
    passwordHash: string;
    hint?: string;
  } | null;
  createdAt: Date;
  lastSeenAt?: Date | null;
  status?: "online" | "offline"; // Kept for simple front-end rendering
  lastSeen?: Date; // Kept for backwards compatibility with front-end
  avatarUrl?: string; // Kept for backwards compatibility
}

export interface WorkspaceDoc {
  _id?: ObjectId;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  ownerId: string;
  /** public workspaces appear in the directory and are self-join */
  visibility: "public" | "private";
  /** share code for joining private (or public) workspaces directly */
  inviteCode: string;
  memberCount: number;
  createdAt: Date;
}

export interface WorkspaceMemberDoc {
  _id?: ObjectId;
  workspaceId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  joinedAt: Date;
}

export interface ChatDoc {
  _id?: ObjectId;
  type: "dm" | "group" | "channel";
  /** null/absent = personal chat; set = channel/group inside that workspace */
  workspaceId?: string | null;
  /** channels only: public channels are auto-joined by workspace members */
  visibility?: "public" | "private" | null;
  title?: string | null;
  username?: string | null;
  photo?: { r2Key: string } | null;
  ownerId?: ObjectId | null;
  settings?: {
    slowModeSeconds: number | null;
    forumMode: boolean | null;
    ttlSeconds: number | null;
    e2ee: boolean | null;
  };
  permissions?: unknown;
  memberCount: number;
  maxSeq: number; // monotonic sequence counter
  lastMessage?: {
    id: string;
    seq: number;
    senderId: string;
    type: string;
    text?: string | null;
    createdAt: Date;
  } | null;
  pinnedMessageIds?: ObjectId[];
  linkedChannelId?: ObjectId | null;
  createdAt: Date;
  
  // Backward compatibility fields for front-end rendering
  name?: string; 
  avatarUrl?: string;
  participants?: string[];
}

export interface MessageDoc {
  _id?: ObjectId;
  chatId: string; // Chat string representation of ObjectId
  seq: number; // per-chat sequence order
  clientMsgId?: string | null; // UUID for idempotency
  threadId?: string | null; // Slack-style threads
  topicId?: string | null; // Forum topics
  senderId: string;
  senderUsername: string; // convenient de-normalization
  type: "text" | "photo" | "video" | "file" | "voice" | "videoNote" | "sticker" | "poll" | "location" | "contact" | "system";
  text?: string | null;
  entities?: Array<{
    type: string; // bold|italic|spoiler|code|link|mention|hashtag
    offset: number;
    length: number;
    meta?: unknown;
  }>;
  media?: {
    r2Key: string;
    thumbR2Key?: string | null;
    mime: string;
    size: number;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
  } | null;
  replyTo?: {
    messageId: string;
    quote?: string | null;
  } | null;
  forwardFrom?: unknown;
  reactions?: Array<{
    emoji: string;
    userIds: string[];
    count: number;
  }>;
  ttlSeconds?: number | null;
  scheduledFor?: Date | null;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt?: Date | null; // bumped on any mutation (edit/delete/reaction) so the sync loop can stream it
  
  // Backward compatibility fields for front-end media URLs
  mediaUrl?: string;
  mediaType?: "image" | "video" | "file";
  mediaName?: string;
  mediaSize?: number;
  readBy?: string[];
  /** "Delete for me": user ids this message is hidden from. */
  hiddenFor?: string[];
}

export interface MemberDoc {
  _id?: ObjectId;
  chatId: string;
  userId: string;
  role: "owner" | "admin" | "member" | "restricted" | "banned";
  permissions?: unknown;
  restrictedUntil?: Date | null;
  anonymous?: boolean | null;
  lastReadSeq?: number | null;
  /** Per-chat push throttle: when this member was last woken by a notification. */
  lastPushAt?: Date | null;
  muted?: boolean | null;
  mutedUntil?: Date | null;
  pinned?: boolean | null;
  archived?: boolean | null;
  folderId?: string | null;
  draft?: {
    text: string;
    replyToMessageId?: string | null;
    createdAt: Date;
  } | null;
  joinedAt: Date;
}

export interface UpdateDoc {
  _id?: ObjectId;
  userId: string;
  pts: number; // monotonic update counter per user
  type: string;
  payload?: unknown;
  createdAt: Date;
}
