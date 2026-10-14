# System design

How heywasp stores data, how its main flows run, who may do what, its limits,
how it fails, how it is secured and how far it scales. Everything here is taken
from the code in this repo; where something is not built, it says so.
See [ARCHITECTURE.md](ARCHITECTURE.md) for the parts and diagrams.

## Data model

MongoDB. Validators and indexes are declared in `src/lib/provision.ts` and applied on
first connect. TypeScript shapes live in `src/lib/db-types.ts` (users, workspaces,
workspace members, chats, members, messages, updates), `src/lib/auth-codes.ts`,
`src/lib/media-pipeline.ts`, `src/lib/push.ts`, `src/lib/post-media.ts` and
`src/app/api/calls/route.ts`. Collections with no TypeScript type (posts, comments,
follows and so on) are described from the route code that writes them.

Ids that point at other documents are stored as **strings** of the ObjectId
(`chatId`, `userId`, `workspaceId`, `authorId`...), except `chats.pinnedMessageIds`,
which holds ObjectIds. Every collection has the usual `_id: ObjectId`.

### `users`

Type `UserDoc` in `src/lib/db-types.ts`. Written by `auth/signup`, `auth/login`,
`auth/profile`, the OTP and reset routes, and the SSE loop (presence).

| Field | Type | Notes |
| --- | --- | --- |
| `username` | string | Lowercase, 3 to 20 chars. Unique sparse index |
| `passwordHash` | string | bcrypt, cost 10 |
| `email` | string or null | Lowercase. Unique sparse index |
| `emailVerified` | bool | Set by a verification code, an OTP sign-in or a password reset |
| `displayName` | string or null | Required at sign-up |
| `bio` | string or null | Trimmed to 300 chars |
| `gender` | string or null | Free text from Settings |
| `dateOfBirth` | string or null | Free text from Settings |
| `avatarUrl` | string | Defaults to a DiceBear URL |
| `bannerUrl` | string or null | Must start with `/uploads/` or `http(s)://` |
| `accountPrivate` | bool | Private accounts gate posts and follow lists behind accepted follows |
| `role` | `"admin"` or null | Staff flag for `/admin`. No API sets it |
| `preferences.defaultPostVisibility` | `public`, `followers`, `private` | Composer default |
| `status` | `online` or `offline` | Kept fresh by the SSE loop |
| `lastSeen` | Date | Bumped by the SSE loop, login and sends |
| `createdAt` | Date | Required by the validator |

Declared in `UserDoc` or the validator but never written by any route: `phone`
(with a unique sparse index), `photos`, `privacy`, `premium`, `twoFactor`,
`lastSeenAt`.

### `workspaces`

Type `WorkspaceDoc`. Written by `api/workspaces`, `workspaces/join`, `workspaces/members`.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Required, max 60 chars |
| `description` | string or null | |
| `avatarUrl` | string or null | DiceBear initials by default, or an uploaded image |
| `ownerId` | string | Creator's user id |
| `visibility` | `public` or `private` | Always created `private`. PATCH can still set `public`, which no route reads for access |
| `inviteCode` | string | 8 hex chars from `randomBytes(4)`. Unique index. Admins can regenerate it |
| `memberCount` | int | Kept with `$inc` on join and remove |
| `createdAt` | Date | |

Indexes: `uniq_invite` on `inviteCode`, `directory` on `visibility, memberCount`.

### `workspace_members`

Type `WorkspaceMemberDoc`. One row per person per workspace.

| Field | Type | Notes |
| --- | --- | --- |
| `workspaceId` | string | |
| `userId` | string | |
| `role` | `owner`, `admin`, `member` | |
| `joinedAt` | Date | |

Indexes: unique `workspaceId, userId`; `userId`. This collection is the access
model: `src/lib/workspace-access.ts` decides who you can find, DM, follow or see
by whether you share a row's `workspaceId` with them.

### `chats`

Type `ChatDoc`. One document per DM, group or channel.

| Field | Type | Notes |
| --- | --- | --- |
| `type` | `dm`, `group`, `channel` | |
| `workspaceId` | string or null | Null for personal DMs and groups; set for workspace channels |
| `visibility` | `public`, `private` or null | Channels: public channels auto-enrol workspace members. Groups: default private |
| `name` | string | Display name. DMs have none; the other user's username is shown |
| `title` | string or null | Mirrors `name` for groups and channels |
| `avatarUrl` | string | DiceBear initials for groups by default |
| `participants` | string[] | User ids. This array is the read/write access check on every chat route |
| `memberCount` | int | |
| `maxSeq` | int | Per-chat message counter, incremented with `$inc` on every send |
| `lastMessage` | object or null | `{ id, seq, senderId, type, text, createdAt }` preview |
| `pinnedMessageIds` | ObjectId[] | |
| `createdAt` | Date | |

Indexes: `uniq_chat_username` (unique sparse on an unused `username` field), `by_type`,
`workspace_channels` on `workspaceId, visibility`. There is no index on
`participants`, which every chat query filters on.

Declared but never written: `username`, `photo`, `ownerId`, `settings`,
`permissions`, `linkedChannelId`.

### `members`

Type `MemberDoc`. One row per person per chat, carrying their role and read state.

| Field | Type | Notes |
| --- | --- | --- |
| `chatId` | string | |
| `userId` | string | |
| `role` | `owner`, `admin`, `member`, `restricted`, `banned` | Only the first three are ever assigned |
| `lastReadSeq` | int or null | |
| `lastPushAt` | Date or null | Per-chat push throttle |
| `joinedAt` | Date | |

Indexes: unique `chatId, userId`; `user_chatlist` on `userId, pinned, archived`.
Declared but never written: `permissions`, `restrictedUntil`, `anonymous`, `muted`,
`mutedUntil`, `pinned`, `archived`, `folderId`, `draft`.

### `messages`

Type `MessageDoc`.

| Field | Type | Notes |
| --- | --- | --- |
| `chatId` | string | |
| `seq` | int | From `chats.maxSeq`; orders the chat |
| `clientMsgId` | string, optional | Client UUID. Unique per chat (sparse index) for idempotent sends |
| `threadId` | string or null | Parent message id for thread replies |
| `senderId` | string | |
| `senderUsername` | string | Denormalised |
| `type` | `text`, `photo`, `video`, `file` | The validator also allows `voice`, `videoNote`, `sticker`, `poll`, `location`, `contact`, `system`, which nothing writes |
| `text` | string or null | Null after delete |
| `mediaUrl`, `mediaType`, `mediaName`, `mediaSize` | string, `image`/`video`/`file`, string, number | Attachment |
| `replyTo` | `{ messageId, quote }` or null | |
| `forwardFrom` | object or null | Stored as sent by the client |
| `reactions` | `[{ emoji, userIds[], count }]` | |
| `readBy` | string[] | User ids |
| `hiddenFor` | string[] | "Delete for me" |
| `editedAt`, `deletedAt` | Date or null | Delete is soft |
| `createdAt`, `updatedAt` | Date | `updatedAt` moves on every mutation so the SSE loop streams it |

Indexes: `chat_seq`, `chat_time`, unique sparse `idempotency` on `chatId, clientMsgId`,
`thread_seq`, and a text index on `text` (no route searches it yet).
Declared but never written: `topicId`, `entities`, `media`, `ttlSeconds`,
`scheduledFor`.

### `typing`

Written by `POST /api/typing`, read by the SSE loop. Not in `provision.ts`, so
MongoDB creates it on first write with no validator and no indexes.

| Field | Type | Notes |
| --- | --- | --- |
| `chatId`, `userId`, `username` | string | One row per user per chat, upserted |
| `expiresAt` | Date | Now plus 5 s. Rows are filtered by it, never deleted |

### `calls`

Type `CallDoc` in `src/app/api/calls/route.ts`.

| Field | Type | Notes |
| --- | --- | --- |
| `chatId` | string | |
| `type` | `audio` or `video` | |
| `status` | `active` or `ended` | |
| `hostId` | string | Who started it |
| `participants` | string[] | People who have joined; accepting is what adds you |
| `heartbeatAt` | Date | Refreshed by each participant's SSE loop |
| `createdAt`, `endedAt` | Date | |

Indexes: `uniq_active_call_per_chat` (unique on `chatId` where `status` is `active`),
`by_participant`, `reaper` on `status, heartbeatAt`.

### `signaling_updates`

Queued WebRTC signals, written by `/api/calls` and `/api/calls/signal`.

| Field | Type | Notes |
| --- | --- | --- |
| `senderId`, `recipientId`, `callId` | string | |
| `type` | `offer`, `answer`, `candidate`, `hangup`, `decline`, `join`, `screen_share` | Anything else is rejected |
| `payload` | any | SDP, ICE candidate or ring details |
| `createdAt` | Date | |

Indexes: `inbox` on `recipientId, createdAt`; TTL 300 s. Rows are deleted once
delivered; the SSE loop ignores rows older than 60 s.

### `media_assets`

Type `MediaAssetDoc` in `src/lib/media-pipeline.ts`. One row per distinct file.

| Field | Type | Notes |
| --- | --- | --- |
| `hash` | string | SHA-256 of the original bytes. Unique |
| `type` | `image`, `video`, `audio`, `file` | From MIME, then extension |
| `mime`, `size`, `name` | string, number, string | First filename seen |
| `uploaderId` | string | |
| `originalUrl` | string | For HEIC, the converted JPEG |
| `rawUrl` | string or null | The exact HEIC bytes |
| `optimizedUrl`, `optimizedSize` | string or null, number or null | WebP up to 2048 px, or the 720p H.264 video |
| `thumbUrl` | string or null | 480 px WebP, or the video poster |
| `width`, `height` | number or null | |
| `durationMs` | number or null | Declared, never set |
| `sensitive` | bool | Borderline NSFW; the UI blurs it |
| `status` | `ready`, `processing`, `failed` | Video transcode state |
| `refCount` | int | Incremented when the same bytes are uploaded again; never decremented |
| `createdAt`, `updatedAt` | Date | |

Indexes: unique `hash`, `originalUrl`, sparse `optimizedUrl`, `uploaderId, createdAt`.

### `posts`

Written by `src/app/api/posts/route.ts` and `src/app/api/posts/[id]/route.ts`.

| Field | Type | Notes |
| --- | --- | --- |
| `authorId` | string | |
| `text` | string | Max 1000 chars |
| `mediaUrl` | string or null | Older single-image posts |
| `media` | PostMedia[] | Up to 4 of `{ url, type, name, size, mime, originalUrl?, thumbUrl?, sensitive?, width?, height? }` (`src/lib/post-media.ts`) |
| `visibility` | `public`, `followers`, `private` | |
| `commentsEnabled` | bool | |
| `hiddenByReports` | bool | Set after 3 reports |
| `likes`, `reposts`, `replies` | int | Counters |
| `editedAt`, `deletedAt` | Date | Delete is soft |
| `createdAt` | Date | |

Indexes: `author_feed`, `global_feed`, `visibility_feed`.

### `comments`

| Field | Type | Notes |
| --- | --- | --- |
| `postId`, `authorId` | string | |
| `text` | string | Max 500 chars |
| `editedAt`, `deletedAt` | Date | Soft delete |
| `deletedBy` | string | Who deleted it (author or post owner) |
| `createdAt` | Date | |

Indexes: `postId, createdAt`; `authorId, createdAt`.

### `post_interactions`

| Field | Type | Notes |
| --- | --- | --- |
| `postId`, `userId` | string | |
| `type` | `like`, `repost`, `bookmark` | |
| `createdAt` | Date | |

Indexes: unique `postId, userId, type`; `userId, type`.

### `follows` and `follow_requests`

| Collection | Fields | Indexes |
| --- | --- | --- |
| `follows` | `followerId` string, `followingId` string, `createdAt` Date | unique `followerId, followingId`; `followingId` |
| `follow_requests` | `requesterId` string, `targetId` string, `createdAt` Date | unique `requesterId, targetId`; `targetId, createdAt` |

### `notifications`

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | string | Recipient |
| `type` | string | `like`, `repost`, `comment`, `follow`, `follow_request`, `follow_accepted` |
| `fromUserId` | string or null | |
| `postId` | string or null | |
| `text` | string or null | Comment preview, 120 chars |
| `read` | bool | Opening the list marks all read |
| `resolved` | `accept` or `decline` | On answered follow requests |
| `createdAt` | Date | TTL: deleted after 30 days |

### `reports`

| Field | Type | Notes |
| --- | --- | --- |
| `targetType` | `post`, `comment`, `user`, `message` | |
| `targetId`, `reporterId` | string | |
| `reason` | `sexual`, `harassment`, `spam`, `violence`, `other` | |
| `details` | string or null | Max 500 chars |
| `createdAt` | Date | |

Indexes: unique `targetType, targetId, reporterId`; `targetType, targetId`; `createdAt`.

### `auth_codes`

Type `AuthCodeDoc` in `src/lib/auth-codes.ts`.

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `login_otp`, `password_reset`, `email_verify` | |
| `email`, `userId` | string | |
| `codeHash` | string | HMAC-SHA256 of `kind:value`, keyed with `JWT_SECRET` |
| `attempts` | int | Wrong guesses against the newest code |
| `expiresAt` | Date | TTL index with `expireAfterSeconds: 0` |
| `consumedAt` | Date, optional | Declared; codes are deleted on use instead |
| `createdAt` | Date | |

### `push_subscriptions`

Type `PushSubscriptionDoc` in `src/lib/push.ts`. No validator.

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | string | Moves to whoever is signed in on that browser |
| `endpoint` | string | Must be `https://`. Unique |
| `keys` | `{ p256dh, auth }` | |
| `userAgent` | string or null | |
| `createdAt` | Date | |

### `contact_messages`

No validator. Written by `POST /api/contact`.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | Max 100 chars |
| `email` | string | Max 200 chars |
| `message` | string | Max 4000 chars |
| `handled` | bool | Toggled from `/admin` |
| `createdAt` | Date | |

### `updates` and `sessions` (provisioned, unused)

`provision.ts` creates `updates` (`userId`, `pts`, `type`, `payload`, `createdAt`,
TTL 14 days) and `sessions` (`userId`, `refreshHash`, `createdAt`) with indexes, but
no route reads or writes either. Sessions are stateless JWTs today.

## Main flows

### Sign-up and sign-in

1. **Sign-up** (`POST /api/auth/signup`): requires username, display name, email
   and password. Username and email are lowercased and checked for uniqueness,
   the password is bcrypt-hashed, a DiceBear avatar URL is set, and the user is
   inserted. A welcome email is sent without waiting. A 7-day JWT is set as the
   `token` cookie and also returned in the body.
2. **Password sign-in** (`POST /api/auth/login`): the identifier is treated as an
   email if it contains `@`, otherwise a username. Wrong user and wrong password
   give the same 401.
3. **Emailed code** (`otp/request` then `otp/verify`): if the address has an
   account and has asked for fewer than 3 codes in 15 minutes, any older unused
   code is deleted, a new 6-digit code is stored as an HMAC and emailed. The
   response is the same whether or not the account exists. Verifying consumes
   the code, marks the email verified and sets the session.
4. **Forgot password** (`password/forgot` then `password/reset`): same pattern
   with a 32-byte random token in a link to `/reset-password`, valid 30 minutes.
   Reset sets the new hash, deletes every outstanding code for the user and
   clears this browser's cookie.
5. **Verify email** (`auth/email/verify`, signed in): `request` emails a code,
   `confirm` checks it belongs to this user and sets `emailVerified`. Changing the
   email in Settings sets it back to unverified.
6. **Account switching**: the client keeps each signed-in account's JWT in
   `localStorage` (`src/lib/accounts.ts`); `POST /api/auth/switch` verifies a saved
   token and sets it as the cookie.

### Workspaces

1. **Create** (`POST /api/workspaces`): inserts a private workspace with a fresh
   invite code, an `owner` row in `workspace_members`, and two public channels,
   `#general` and `#random`, with the creator as channel owner.
2. **Join** (`POST /api/workspaces/join`): an invite code is the only way in.
   Adds a `member` row, increments `memberCount`, then adds the user to every
   public channel of the workspace (`joinAllPublicChannels`).
3. **Create a channel** (`POST /api/workspaces/channels`): any workspace member.
   Names are lowercased with spaces turned into dashes and must be unique in the
   workspace. A public channel includes every current workspace member at once;
   a private one starts with only the creator.
4. **Leave or remove** (`DELETE /api/workspaces/members`): removes the membership
   and pulls the user out of every channel in that workspace.

### Sending and receiving a message

1. `POST /api/messages` checks the sender is in `chats.participants`.
2. If `clientMsgId` was already stored for that chat, the stored message is
   returned (retries never duplicate).
3. `chats.maxSeq` is incremented atomically and the message is inserted with the
   new `seq`, then `chats.lastMessage` (top-level messages only) and the sender's
   `members.lastReadSeq` are updated.
4. Web push goes, without waiting, to participants whose stream is not live
   (status offline, or last seen more than 15 s ago), at most once per chat per
   2 minutes per person.
5. Each recipient's SSE loop finds `maxSeq` above its pointer within 1.5 s and
   streams the new rows in `seq` order.
6. Opening a chat (`GET /api/messages`) returns every top-level message not hidden
   for the reader, adds the reader to `readBy` on all messages from others and sets
   `members.lastReadSeq`.

Edits, deletes and reactions set `updatedAt`, which the SSE loop's mutation sweep
picks up. Thread replies are messages with `threadId` set, read through
`GET /api/messages/threads`.

### Uploading media

1. `POST /api/media/upload` takes one multipart file. Executable extensions are
   refused (415), files over 25 MB are refused (413).
2. The SHA-256 of the bytes is looked up in `media_assets`. A hit returns the
   existing asset and bumps `refCount`; nothing new is stored.
3. Raster images other than GIF are scanned by the NSFW classifier first: explicit images are
   rejected (422), borderline ones are kept and flagged `sensitive`. HEIC is
   converted to JPEG. The original, a WebP display copy up to 2048 px (kept only
   if it is at least 8% smaller, or the source was HEIC) and a 480 px thumbnail
   are stored.
4. Videos are stored as-is, then ffmpeg grabs a poster at 1 s (which is scanned the
   same way) and, in the background, encodes an H.264 copy at most 1280 px wide,
   CRF 26, 2 threads. It is adopted only if it is at least 10% smaller.
5. Everything else (GIF, SVG, audio, documents, code) is stored as-is and is not
   scanned, except that HTML, JavaScript, TypeScript, shell and server-script
   files are stored as `text/plain`.
6. Read routes call `resolveAssets()` to swap in the optimised URL once it exists.

### Calls

1. The caller's browser gets camera or microphone access first.
2. `POST /api/calls` ends any call in the chat with no heartbeat for 30 s, then
   upserts the single active call and adds the caller. On a duplicate-key race it
   retries once and joins the winner.
3. A new call queues a `join` signal for every other chat member and pushes
   "Incoming call" to anyone without a live stream (30 s throttle). Joining an
   existing call queues `join` for the people already in it.
4. The response carries the call, an `rtcToken` (JWT, 6 h) and TURN servers.
5. Offers, answers and candidates go through `POST /api/calls/signal`, which
   checks both ends are in the chat and that the sender has joined (except for
   `hangup` and `decline`).
6. Leaving (`DELETE /api/calls` or the `sendBeacon` alias on tab close) removes the
   user; the last one out ends the call and sends `hangup` to everyone still ringing.
   An unanswered call gives up after 45 s on both ends.

### Posts, comments and reports

1. `POST /api/posts`: text is checked by the `obscenity` matcher, media is
   validated (at most 4 items, 25 MB each, URLs must be `/uploads/` paths or any
   `http(s)` URL).
2. `GET /api/posts` builds the feed from posts by you and people who share a
   workspace with you, filtered by visibility and follows, plus reposts by people
   you follow, minus posts from private accounts you don't follow and posts hidden
   by reports (their author still sees them).
3. Like, repost and bookmark are toggles in `post_interactions`; like and repost
   also adjust the counters and notify the author. Each requires that you can see
   the post (`canViewPost` in `src/lib/post-access.ts`).
4. Comments require that you can see the post and that comments are on.
5. `POST /api/reports`: one report per person per target. The third report on a
   post sets `hiddenByReports`.

### Follows

Following a public account inserts a `follows` row and notifies them; following a
private account creates a `follow_requests` row instead, which they accept or
decline from Notifications. Making an account public accepts every pending request.
Unfollowing and cancelling a request never need a shared workspace; new follows do.

### Backups

`POST /api/internal/backup` with the right `x-backup-key` dumps every collection
as EJSON, gzips it, writes it to the bucket under `backups/<HMAC prefix>/` and
deletes all but the newest 14. It has to be called by an outside scheduler.

## Roles and permissions

**Site level.** Every signed-in user is equal, except `users.role === "admin"`,
which unlocks `/admin` and `/api/admin/*` (overview counts, user list, contact
inbox). The role is set by hand in the database; no route grants it.

**The workspace gate.** You can only find, DM, add to a group, follow, view the
profile of, or see posts from someone who shares a workspace with you
(`src/lib/workspace-access.ts`). A user with no workspace sees nobody. Existing
DMs and follows are never revoked when membership changes; only new ones are gated.

**Workspace roles** (`workspace_members.role`):

| Action | Owner | Admin | Member |
| --- | --- | --- | --- |
| See channels and members, create channels, join public channels | yes | yes | yes |
| Edit name, description, image, visibility; regenerate invite code | yes | yes | no |
| Remove a member | yes | yes | no |
| Remove an admin | yes | no | no |
| Promote or demote (admin or member) | yes | no | no |
| Leave | no | yes | yes |

The owner cannot leave or be removed, and there is no route to transfer ownership.

**Chat roles** (`members.role`):

| Action | Owner or admin | Member |
| --- | --- | --- |
| Send, react, reply, edit or delete own messages, delete for me | yes | yes |
| Rename, change photo, change group visibility | yes | no |
| Add members (must share a workspace), remove members, promote or demote | yes | no |
| Delete anyone's message | yes | no |
| Pin in groups and channels | yes | no |
| Leave | admin yes, owner no | yes |

In a DM either person can pin. A group owner cannot be removed or demoted. The
message route also restricts posting to admins in channels that have no
workspace, but no route creates such a channel.

**Posts.** Only the author edits, deletes, changes visibility or turns comments
off. Comment authors edit their own comments; the comment author or the post
owner can delete one.

## Limits

| What | Limit | Where |
| --- | --- | --- |
| Username | 3 to 20 chars | `auth/signup`, `auth/profile` |
| Password | at least 6 chars | signup, profile, reset |
| Bio | 300 chars | `auth/profile` |
| Post text | 1000 chars | `api/posts` |
| Comment | 500 chars | `posts/[id]/comments` |
| Attachments | 4 per post, 25 MB per file | `src/lib/post-media.ts` |
| Text preview | 1 MB | `src/lib/post-media.ts` |
| Workspace name | 60 chars | `api/workspaces` |
| Channel name | 50 chars | `workspaces/channels` |
| Contact form | name 100, email 200, message 4000 | `api/contact` |
| Report details | 500 chars | `api/reports` |
| Sign-up | 15 per IP per hour | `src/proxy.ts` |
| Password sign-in | 30 per IP per 10 min | `src/proxy.ts` |
| Code request, password forgot | 5 per IP per 15 min each | `src/proxy.ts` |
| Contact form | 5 per IP per hour | `src/proxy.ts` |
| Emailed codes | 3 per address per kind per 15 min | `src/lib/auth-codes.ts` |
| Code guesses | 5, then the code is deleted | `src/lib/auth-codes.ts` |
| Code lifetime | sign-in 10 min, reset 30 min, verify 15 min | `src/lib/auth-codes.ts` |
| Session | 7 days | `src/lib/session.ts` |
| Call token | 6 hours | `api/calls` |
| Unanswered call | 45 s | `ChatWorkspace.tsx` |
| Stale call | 30 s without heartbeat | `api/calls` |
| Video bitrate | 2.5 Mbps video, 128 kbps audio per sender | `ChatWorkspace.tsx` |
| Push throttle | 2 min per chat for messages, 30 s for calls | `src/lib/push.ts`, `api/calls` |
| Lists | notifications 50, comments 200, follow lists 200, discover 50, people search 50, summary input 100 messages, admin lists 200 | route files |
| Auto-hide | 3 reports | `api/reports` |
| Backups kept | 14 | `internal/backup` |
| MongoDB pool | 20 connections per process | `src/lib/mongodb.ts` |

Not limited: the feed's `limit` parameter has no maximum, message history is not
paginated, workspace join attempts (invite-code guesses) are not rate-limited, and
there are no limits on messages per minute.

## Failure handling

- **Database.** The client connects lazily, so builds work without a database. A
  provisioning error on one collection is logged and the rest continue. Every
  route catches errors and answers 500 with a generic message.
- **Email.** Code and reset routes answer 502 "We couldn't send the email just now"
  when Harakumo Mail fails or times out (15 s). Welcome and contact emails are
  fire-and-forget; the account or message is already saved.
- **Storage.** Without bucket settings in production, uploads fail on purpose
  instead of writing to a disk that disappears on redeploy.
- **Image scanning.** If the NSFW model cannot load or a scan throws, the upload is
  accepted unscanned and the error is logged.
- **Video.** Without ffmpeg the original is served. A failed transcode sets
  `status: "failed"` and the original stays in use.
- **TURN.** If the credential call fails, the last cached servers are used, or none
  (STUN only).
- **Push.** Subscriptions answering 404 or 410 are deleted; other failures are logged.
- **Realtime.** The SSE loop never overlaps itself, stops on client abort, and
  stops when a write to the stream throws. Signals are deleted only after they
  were written, so a dropped stream leaves the rest queued for the reconnect.
  The browser reconnects 3 s after an error. On SIGTERM the server exits after 5 s
  so rollouts are not held open by streams.
- **Duplicate sends.** `clientMsgId` returns the stored message on retry. Two
  identical requests racing each other would hit the unique index on the second
  insert (a 500) after `maxSeq` was already bumped, leaving a gap in `seq`, which
  the stream tolerates because it reads `seq > pointer`.
- **Calls.** One active call per chat is enforced by the index; stale calls are
  ended after 30 s without a heartbeat; the client buffers ICE candidates that
  arrive before their offer, restarts ICE once, and shows a toast naming the peer
  when a connection fails.

## Security

What the code does:

- **Passwords**: bcrypt, cost 10. Wrong username and wrong password look the same.
- **Sessions**: JWT (`JWT_SECRET`, 7 days) in an httpOnly cookie, `SameSite=Lax`,
  `Secure` in production. In production a missing `JWT_SECRET` throws instead of
  falling back to the development secret in `src/lib/secret.ts`.
- **Emailed codes**: never stored in plaintext (HMAC-SHA256 keyed with
  `JWT_SECRET`), compared in constant time, single use, short TTL enforced by query
  and TTL index, 5 guesses, 3 sends per address per 15 min. Request endpoints
  answer the same whether or not an account exists.
- **Enumeration**: profiles, follow counts and follow lists answer an identical 404
  for "no such user" and "not in your workspace". Starting a DM answers 404 in
  both cases, though the error text differs.
- **Access checks**: every chat route checks `chats.participants`; role changes
  check `members` or `workspace_members`; post reads, likes and comments go through
  `canViewPost` (deleted, workspace, private account, visibility).
- **Calls**: a signal is accepted only if both sender and recipient are in the chat,
  and media signals only from someone who has joined.
- **Uploads**: executables refused; HTML, JS and scripts stored as `text/plain`;
  `/api/media/proxy` serves only our own upload URLs, capped at 25 MB, as
  `text/plain` or `application/octet-stream` with `nosniff`; HTML previews render in
  an `<iframe sandbox="">` with no scripts.
- **Moderation**: images scanned in-process; post and comment text screened on
  create; DMs are not filtered; 3 reports hide a post.
- **Admin**: role checked on the server for every admin route.
- **Backups**: the endpoint needs an HMAC-derived key compared in constant time;
  dumps go under a prefix derived from `JWT_SECRET`.
- **Rate limits**: per IP in process memory on sign-up, sign-in, code requests,
  password reset and the contact form.

Known gaps, as the code stands:

- **Sessions cannot be revoked.** JWTs are stateless and the `sessions` collection is
  unused. Logout and password reset clear only the current browser's cookie; any
  other copy of the token works until it expires.
- **Tokens in `localStorage`.** Account switching stores every signed-in account's
  JWT in `localStorage`, where page scripts can read it.
- **Password change needs no current password.** `PUT /api/auth/profile` accepts a
  new password from any valid session.
- **Edits skip the text filter.** Editing a post or comment does not re-run
  `assertCleanText`.
- **GIF and SVG uploads are not scanned** by the image classifier.
- **Backups share the media bucket.** Dumps (including password hashes) sit in the
  same bucket that serves media publicly; only the derived prefix hides them.
- **No CSRF token or security headers.** State-changing requests rely on
  `SameSite=Lax` cookies and JSON bodies; `next.config.ts` sets no CSP or other
  headers.
- **Rate limits are per process** and do not cover invite-code joins.
- `avatarUrl` on the profile and group routes is stored without checking the URL.
- There are no automated tests and no CI configuration in this repo.

## How it scales

What holds up:

- All shared state is in MongoDB, so more server instances can run side by side:
  a message written through one instance is picked up by SSE loops on all of them.
- Messages are ordered by an atomic per-chat counter, and media is deduplicated by
  content hash.

Where it stops, in the order you would likely hit it:

1. **SSE polling.** Every open tab runs a pass every 1.5 s that does several queries:
   update the user, list their chats, fetch new messages per chat, sweep
   mutations, read typing, read presence, read signals, update call heartbeats.
   Load on MongoDB grows with open tabs times chats. There is no index on
   `chats.participants`, which most of these queries filter on. MongoDB change
   streams or a pub/sub layer are not used.
2. **Chat list.** `GET /api/chats` runs two or three queries per chat (last message,
   unread count, the other DM user).
3. **Message history.** `GET /api/messages` returns every top-level message in the
   chat and marks them read in one go; long chats get slower to open.
4. **Group calls.** Calls are a full mesh: each person uploads a stream to every
   other person, so practical calls are small. There is no media server.
5. **One process does everything.** Image processing, the NSFW model and ffmpeg
   (capped at 2 threads) run in the same process as the SSE streams. The README
   gives about 180 MB idle, about 330 MB with the image model loaded and up to
   about 760 MB while transcoding 1080p video.
6. **Per-instance state.** Rate-limit windows, the TURN credential cache and the
   NSFW model are per process.

## Not built

- The `/ws/rtc` WebSocket signalling hub (the client supports it; the server is not in this repo).
- The "AI summary" (`GET /api/chats/summarize`) is keyword heuristics over the last
  100 messages; no language model is called.
- Message search (a text index exists, no route uses it).
- Workspace ownership transfer.
- Payments or plans.
- Use of the declared-but-unused fields listed above (mute, archive, drafts, polls,
  scheduled and expiring messages, two-factor sign-in).
- Server-side session storage and revocation.
- Tests and CI.
