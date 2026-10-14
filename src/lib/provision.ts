import { Db, IndexDirection } from "mongodb";

export const COLLECTIONS: Record<string, { validator?: unknown; indexes?: Array<{ key: Record<string, IndexDirection>; options?: Record<string, unknown> }> }> = {
  users: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["createdAt"],
        properties: {
          phone:       { bsonType: ["string", "null"] },
          email:       { bsonType: ["string", "null"] },
          username:    { bsonType: ["string", "null"] },
          displayName: { bsonType: ["string", "null"] },
          bio:         { bsonType: ["string", "null"] },
          emailVerified: { bsonType: "bool" },
          createdAt:  { bsonType: "date" },
          lastSeenAt: { bsonType: ["date", "null"] }
        }
      }
    },
    indexes: [
      { key: { username: 1 }, options: { unique: true, sparse: true, name: "uniq_username" } },
      { key: { phone: 1 },    options: { unique: true, sparse: true, name: "uniq_phone" } },
      { key: { email: 1 },    options: { unique: true, sparse: true, name: "uniq_email" } }
    ]
  },

  chats: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["type", "createdAt"],
        properties: {
          type:     { enum: ["dm", "group", "channel"] },
          title:    { bsonType: ["string", "null"] },
          username: { bsonType: ["string", "null"] },
          workspaceId:     { bsonType: ["string", "null"] },
          visibility:      { enum: ["public", "private", null] },
          memberCount:     { bsonType: ["int", "long"] },
          maxSeq:          { bsonType: ["int", "long"] },
          createdAt:       { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { username: 1 }, options: { unique: true, sparse: true, name: "uniq_chat_username" } },
      { key: { type: 1 },     options: { name: "by_type" } },
      { key: { workspaceId: 1, visibility: 1 }, options: { sparse: true, name: "workspace_channels" } }
    ]
  },

  workspaces: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["name", "ownerId", "visibility", "inviteCode", "createdAt"],
        properties: {
          name:        { bsonType: "string" },
          description: { bsonType: ["string", "null"] },
          avatarUrl:   { bsonType: ["string", "null"] },
          ownerId:     { bsonType: "string" },
          visibility:  { enum: ["public", "private"] },
          inviteCode:  { bsonType: "string" },
          memberCount: { bsonType: ["int", "long"] },
          createdAt:   { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { inviteCode: 1 }, options: { unique: true, name: "uniq_invite" } },
      { key: { visibility: 1, memberCount: -1 }, options: { name: "directory" } }
    ]
  },

  media_assets: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["hash", "type", "originalUrl", "status", "createdAt"],
        properties: {
          hash:         { bsonType: "string" },
          type:         { enum: ["image", "video", "audio", "file"] },
          mime:         { bsonType: "string" },
          size:         { bsonType: ["int", "long", "double"] },
          originalUrl:  { bsonType: "string" },
          optimizedUrl: { bsonType: ["string", "null"] },
          thumbUrl:     { bsonType: ["string", "null"] },
          status:       { enum: ["ready", "processing", "failed"] },
          refCount:     { bsonType: ["int", "long"] },
          createdAt:    { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { hash: 1 }, options: { unique: true, name: "uniq_hash" } },
      { key: { originalUrl: 1 }, options: { name: "by_original" } },
      { key: { optimizedUrl: 1 }, options: { sparse: true, name: "by_optimized" } },
      { key: { uploaderId: 1, createdAt: -1 }, options: { name: "by_uploader" } }
    ]
  },

  workspace_members: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["workspaceId", "userId", "role", "joinedAt"],
        properties: {
          workspaceId: { bsonType: "string" },
          userId:      { bsonType: "string" },
          role:        { enum: ["owner", "admin", "member"] },
          joinedAt:    { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { workspaceId: 1, userId: 1 }, options: { unique: true, name: "uniq_ws_membership" } },
      { key: { userId: 1 }, options: { name: "ws_by_user" } }
    ]
  },

  messages: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["chatId", "seq", "senderId", "type", "createdAt"],
        properties: {
          chatId:      { bsonType: "string" },
          seq:         { bsonType: ["int", "long"] },
          clientMsgId: { bsonType: ["string", "null"] },
          threadId:    { bsonType: ["string", "null"] },
          topicId:     { bsonType: ["string", "null"] },
          senderId:    { bsonType: "string" },
          type:        { enum: ["text","photo","video","file","voice","videoNote","sticker","poll","location","contact","system"] },
          text:        { bsonType: ["string", "null"] },
          createdAt:   { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { chatId: 1, seq: -1 },        options: { name: "chat_seq" } },
      { key: { chatId: 1, createdAt: -1 },  options: { name: "chat_time" } },
      { key: { chatId: 1, clientMsgId: 1 }, options: { unique: true, sparse: true, name: "idempotency" } },
      { key: { threadId: 1, seq: -1 },      options: { sparse: true, name: "thread_seq" } },
      { key: { text: "text" },              options: { name: "text_search", default_language: "english" } }
    ]
  },

  members: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["chatId", "userId", "role", "joinedAt"],
        properties: {
          chatId:        { bsonType: "string" },
          userId:        { bsonType: "string" },
          role:          { enum: ["owner", "admin", "member", "restricted", "banned"] },
          lastReadSeq:   { bsonType: ["int", "long", "null"] },
          joinedAt:      { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { chatId: 1, userId: 1 }, options: { unique: true, name: "uniq_membership" } },
      { key: { userId: 1, pinned: -1, archived: 1 }, options: { name: "user_chatlist" } }
    ]
  },

  updates: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["userId", "pts", "type", "createdAt"],
        properties: {
          userId:    { bsonType: "string" },
          pts:       { bsonType: ["int", "long"] },
          type:      { bsonType: "string" },
          createdAt: { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { userId: 1, pts: 1 }, options: { name: "user_pts" } },
      { key: { createdAt: 1 }, options: { expireAfterSeconds: 1209600, name: "ttl_14d" } }
    ]
  },

  sessions: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["userId", "createdAt"],
        properties: {
          userId:        { bsonType: "string" },
          refreshHash:   { bsonType: ["string", "null"] },
          createdAt:     { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { userId: 1 }, options: { name: "by_user" } },
      { key: { refreshHash: 1 }, options: { unique: true, sparse: true, name: "uniq_refresh" } }
    ]
  },

  posts: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["authorId", "text", "createdAt"],
        properties: {
          authorId:    { bsonType: "string" },
          text:        { bsonType: "string" },
          mediaUrl:    { bsonType: ["string", "null"] },
          media:       { bsonType: "array", items: { bsonType: "object", required: ["url", "type"], properties: {
                           url:  { bsonType: "string" },
                           type: { enum: ["image", "video", "audio", "file"] },
                           name: { bsonType: "string" },
                           size: { bsonType: ["int", "long", "double"] },
                           mime: { bsonType: "string" } } } },
          visibility:  { enum: ["public", "followers", "private", null] },
          commentsEnabled: { bsonType: "bool" },
          hiddenByReports: { bsonType: "bool" },
          editedAt:    { bsonType: ["date", "null"] },
          deletedAt:   { bsonType: ["date", "null"] },
          likes:       { bsonType: ["int", "long"] },
          reposts:     { bsonType: ["int", "long"] },
          replies:     { bsonType: ["int", "long"] },
          createdAt:   { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { authorId: 1, createdAt: -1 }, options: { name: "author_feed" } },
      { key: { createdAt: -1 }, options: { name: "global_feed" } },
      { key: { visibility: 1, createdAt: -1 }, options: { name: "visibility_feed" } }
    ]
  },

  comments: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["postId", "authorId", "text", "createdAt"],
        properties: {
          postId:    { bsonType: "string" },
          authorId:  { bsonType: "string" },
          text:      { bsonType: "string" },
          editedAt:  { bsonType: ["date", "null"] },
          deletedAt: { bsonType: ["date", "null"] },
          createdAt: { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { postId: 1, createdAt: 1 }, options: { name: "post_comments" } },
      { key: { authorId: 1, createdAt: -1 }, options: { name: "by_author" } }
    ]
  },

  post_interactions: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["postId", "userId", "type", "createdAt"],
        properties: {
          postId:    { bsonType: "string" },
          userId:    { bsonType: "string" },
          type:      { enum: ["like", "repost", "bookmark"] },
          createdAt: { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { postId: 1, userId: 1, type: 1 }, options: { unique: true, name: "uniq_interaction" } },
      { key: { userId: 1, type: 1 }, options: { name: "user_interactions" } }
    ]
  },

  follows: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["followerId", "followingId", "createdAt"],
        properties: {
          followerId:  { bsonType: "string" },
          followingId: { bsonType: "string" },
          createdAt:   { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { followerId: 1, followingId: 1 }, options: { unique: true, name: "uniq_follow" } },
      { key: { followingId: 1 }, options: { name: "followers" } }
    ]
  },

  auth_codes: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["kind", "email", "userId", "codeHash", "expiresAt", "createdAt"],
        properties: {
          kind:       { enum: ["login_otp", "password_reset", "email_verify"] },
          email:      { bsonType: "string" },
          userId:     { bsonType: "string" },
          codeHash:   { bsonType: "string" },
          attempts:   { bsonType: ["int", "long"] },
          expiresAt:  { bsonType: "date" },
          createdAt:  { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { kind: 1, email: 1, createdAt: -1 }, options: { name: "by_kind_email" } },
      { key: { userId: 1 }, options: { name: "by_user" } },
      // Mongo sweeps expired codes itself; verification also checks expiry.
      { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0, name: "ttl_expiry" } }
    ]
  },

  reports: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["targetType", "targetId", "reporterId", "reason", "createdAt"],
        properties: {
          targetType: { enum: ["post", "comment", "user", "message"] },
          targetId:   { bsonType: "string" },
          reporterId: { bsonType: "string" },
          reason:     { enum: ["sexual", "harassment", "spam", "violence", "other"] },
          details:    { bsonType: ["string", "null"] },
          createdAt:  { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { targetType: 1, targetId: 1, reporterId: 1 }, options: { unique: true, name: "uniq_report" } },
      { key: { targetType: 1, targetId: 1 }, options: { name: "by_target" } },
      { key: { createdAt: -1 }, options: { name: "recent" } }
    ]
  },

  follow_requests: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["requesterId", "targetId", "createdAt"],
        properties: {
          requesterId: { bsonType: "string" },
          targetId:    { bsonType: "string" },
          createdAt:   { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { requesterId: 1, targetId: 1 }, options: { unique: true, name: "uniq_request" } },
      { key: { targetId: 1, createdAt: -1 }, options: { name: "incoming" } }
    ]
  },

  notifications: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["userId", "type", "createdAt"],
        properties: {
          userId:     { bsonType: "string" },
          type:       { bsonType: "string" },
          fromUserId: { bsonType: ["string", "null"] },
          postId:     { bsonType: ["string", "null"] },
          text:       { bsonType: ["string", "null"] },
          read:       { bsonType: "bool" },
          createdAt:  { bsonType: "date" }
        }
      }
    },
    indexes: [
      { key: { userId: 1, createdAt: -1 }, options: { name: "user_notifs" } },
      { key: { createdAt: 1 }, options: { expireAfterSeconds: 2592000, name: "ttl_30d" } }
    ]
  },

  contact_messages: {
    indexes: [
      { key: { handled: 1, createdAt: -1 }, options: { name: "inbox" } }
    ]
  },

  push_subscriptions: {
    indexes: [
      { key: { endpoint: 1 }, options: { unique: true, name: "uniq_endpoint" } },
      { key: { userId: 1 }, options: { name: "by_user" } }
    ]
  },

  calls: {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["chatId", "type", "status", "createdAt"],
        properties: {
          chatId:    { bsonType: "string" },
          type:      { enum: ["audio", "video"] },
          status:    { enum: ["active", "ended"] },
          hostId:    { bsonType: ["string", "null"] },
          createdAt: { bsonType: "date" },
          endedAt:   { bsonType: ["date", "null"] }
        }
      }
    },
    indexes: [
      // At most one live call per chat — this is what makes the join/start
      // upsert in /api/calls safe against two people dialling at once.
      {
        key: { chatId: 1 },
        options: {
          unique: true,
          name: "uniq_active_call_per_chat",
          partialFilterExpression: { status: "active" }
        }
      },
      { key: { participants: 1 }, options: { name: "by_participant" } },
      { key: { status: 1, heartbeatAt: 1 }, options: { name: "reaper" } }
    ]
  },

  signaling_updates: {
    indexes: [
      // The SSE tick polls this on every connected client every 1.5s.
      { key: { recipientId: 1, createdAt: 1 }, options: { name: "inbox" } },
      // Signals are delivered-then-deleted; the TTL only mops up undelivered
      // ones so a client that was offline never wakes to a stale ring.
      { key: { createdAt: 1 }, options: { expireAfterSeconds: 300, name: "ttl_5m" } }
    ]
  }
};

export async function provisionWasp(db: Db) {
  console.log("Starting WASP database provisioning...");
  
  for (const [name, def] of Object.entries(COLLECTIONS)) {
    try {
      // 1. Create collection if it does not exist
      const collections = await db.listCollections({ name }).toArray();
      const exists = collections.length > 0;
      
      if (!exists) {
        await db.createCollection(name, def.validator ? { validator: def.validator } : {});
        console.log(`Created collection: ${name}`);
      } else if (def.validator) {
        await db.command({ collMod: name, validator: def.validator });
        console.log(`Updated validator schema for collection: ${name}`);
      }

      // 2. Ensure indexes
      if (def.indexes && def.indexes.length > 0) {
        // Drop conflicting indexes if necessary or just create them
        await db.collection(name).createIndexes(
          def.indexes.map((idx) => ({
            key: idx.key,
            ...idx.options,
          }))
        );
        console.log(`Ensured indexes on collection: ${name} (${def.indexes.length} indexes)`);
      }
    } catch (err) {
      console.error(`Error provisioning collection ${name}:`, err);
    }
  }

  console.log("WASP database provisioning completed successfully.");
}
