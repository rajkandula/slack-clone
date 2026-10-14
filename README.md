# WASP

Real-time messaging with **personal chats** (WhatsApp/Telegram-style) and **team
workspaces** (Slack/Discord-style), plus a light social layer. Next.js 16 + MongoDB +
WebRTC.

## Product model

WASP keeps two worlds strictly separate so it is always obvious where a message goes:

| Container | What lives there | How you get in |
| --- | --- | --- |
| **Personal** | DMs and personal group chats | Start a chat by username |
| **Workspace** | `#channels` and workspace groups | Public directory, or an invite code |

- DMs are global and personal — one thread per person, never duplicated per workspace.
- Joining a workspace enrols you in **every public channel** in it immediately, and in
  any public channel created later. Private channels are invite-only.
- The sidebar only ever shows one container at a time; switching workspaces closes the
  open conversation from the previous one.

## Features

**Messaging** — DMs, groups, workspace channels · text + media (S3-compatible object storage with local
fallback) · edit / soft-delete · emoji reactions · reply with quote · Slack-style threads ·
forward · pin · typing indicators · read receipts · idempotent, sequence-ordered delivery.

**Workspaces** — create public/private workspaces (with default `#general` + `#random`) ·
browsable directory · invite codes · channel browser with one-click join · ⓘ workspace panel
(about, members, invite code, admin settings: name/description/image/visibility, roles,
remove/leave) · one rail switcher for any number of workspaces.

**Groups & members** — rename, change photo, add/remove members, make/remove admins, leave ·
**private by default**; public groups are discoverable in *Find Groups* and joinable by anyone.

**Posts & attachments** — up to 4 attachments per post: images, video, audio, and files.
Everything previews **inside the feed** with one consistent card:

| Format | Preview |
| --- | --- |
| Images (JPG/PNG/WebP/HEIC/GIF), video, audio, PDF | native |
| Markdown | rendered (GFM, highlighted code, ```mermaid fences drawn) + source toggle |
| Mermaid `.mmd` | diagram + source |
| HTML | sandboxed render (no scripts) + source |
| SVG | image + source |
| Code / config / logs (`js ts py go rs java … json yaml xml sql css sh`) | syntax-highlighted |
| CSV / TSV | table |
| XLSX / XLS / ODS | sheet tabs + grid |
| DOCX | rendered document |
| EPUB | paged reader |
| PPTX, archives, other | download chip |

**Media pipeline** (`src/lib/media-pipeline.ts`) — every upload is **content-addressed**
(SHA-256 → one `media_assets` record; re-uploads, forwards and shares never store a second
copy). Images are EXIF-rotated, **HEIC → JPEG**, and get a ≤2048px WebP display rendition +
480px thumbnail while the original is kept for full quality. Videos get a poster immediately
and a background **ffmpeg 720p H.264** rendition that read APIs swap in when ready (originals
are served if ffmpeg is absent). HTML/JS uploads are stored as `text/plain`; executables are
rejected; previews for non-native formats fetch bytes through `/api/media/proxy`.

**Calls** — 1:1 and group audio/video over WebRTC, screen sharing, add participant mid-call.
Capture asks for 720p30 and processed audio (echo cancellation, noise suppression, auto gain);
video senders are capped at 2.5 Mbps with balanced degradation so a weak uplink degrades
smoothly instead of freezing. A per-peer stats watchdog overlays "Poor connection — video
paused" on a tile when frames stop arriving, and a failed ICE path (after one restart)
surfaces a toast naming the peer instead of a silent black tile.
The microphone/camera is acquired *before* the call is announced (so a peer is never
connected with no tracks), ICE candidates that arrive ahead of their offer are buffered and
replayed, and renegotiation follows the perfect-negotiation pattern so simultaneous offers
and mid-call track changes both settle. A call keeps running when you switch to Home/Explore
— the overlay is portalled to `<body>` and the messages view stays mounted. Unanswered calls
give up after 45s, closing the tab hands the call back via `sendBeacon`, and clients in a
call heartbeat the server so a crashed tab's call is reaped instead of blocking every later
call in that chat.

In-call signalling (offers, answers, candidates) and the initial ring travel over the
Mongo/SSE path below. The client can also use a faster WebSocket room per call at
`/ws/rtc`, entered with the per-call `rtcToken` that `/api/calls` mints; this release does
not ship that hub, so the client falls back to SSE on its own. Media is 720p/30 by preference, VP9-first, Opus with in-band FEC
+ DTX, a 2.5 Mbps sender cap, and a stats watchdog that labels a stalled tile
"Poor connection" instead of leaving it black.

**TURN** (a hosted TURN service): `/api/calls` exchanges `TURN_API_TOKEN` at
`TURN_CREDENTIALS_URL` for short-lived relay credentials (cached 1h, 24h TTL) and
returns them with the call, so peers behind carrier NAT and strict firewalls connect through
the relay. Without the two values the app degrades to STUN-only. The static `NEXT_PUBLIC_TURN_*` build args
remain as an override for a self-hosted relay.

**Realtime** — one Server-Sent Events stream (`/api/messages/sync`) carries new messages,
mutations (edits/deletes/reactions), typing, presence, and WebRTC signalling.

**Social** — posts with a per-post audience (Public / Followers / Only me, default set in
Settings), edit · delete · comments (author edits/deletes own; post owner can turn comments
off or remove any comment), likes, reposts surfaced in feeds as "X reposted", saved posts ·
Likes/Saved tabs on your profile · `/u/<username>` profiles · follow graph · **private
accounts** with follow requests (accept/decline inline in Notifications) · Explore.

**Accounts** — Settings (`/settings`): profile picture, display name, username, bio, email,
theme, default post audience, private account · **multi-account switching** from the avatar
menu (sign into several accounts, switch in one click, forget per device).

**Email auth** (via [Harakumo](https://harakumo.com) Mail) — three flows, all backed by
single-use codes:
- **Passwordless sign-in** — "Email me a sign-in code" sends a 6-digit OTP (10 min).
- **Forgot password** — emails a single-use reset link (30 min) to `/reset-password`;
  resetting revokes every outstanding code and clears the session.
- **Email verification** — Settings → Account confirms the address with a code (15 min);
  changing your email marks it unverified again, and an OTP sign-in verifies it implicitly.

Codes are never stored in plaintext (HMAC-SHA256 keyed with `JWT_SECRET`), are single-use,
expire via both query checks and a Mongo TTL index, burn after 5 wrong attempts, and are
rate-limited to 3 sends per address per 15 minutes. The request endpoints answer identically
whether or not an account exists, so they can't be used to discover who is registered.

> Identity stays in MongoDB — Harakumo **Auth pools are deliberately not used**, since every
> collection references a Mongo user `_id` and pools offer no OTP or password reset. Harakumo
> is the delivery channel only; codes are minted and verified in `src/lib/auth-codes.ts`.

**Guardrails & safety** — every uploaded image (and each video's poster frame) is scored by
a **self-hosted NSFW classifier** (nsfwjs / MobileNetV2 on pure-JS TensorFlow, no external
API): clearly explicit uploads are **rejected (422)**; borderline media is stored but marked
*sensitive* and blurred in feeds behind a click-to-reveal cover. Public text (posts,
comments) is screened by the `obscenity` matcher and rejected with a clear error — DMs are
private speech and are not filtered. Any post can be **reported** (nudity/sexual,
harassment, spam, violence, other) from its ⋯ menu; **3 independent reports auto-hide** the
post from all feeds (the author still sees it). One report per person per target; the model
loads once (~4 MB) and scanning degrades gracefully to "allow, unscanned" if it can't.

**Other** — AI conversation summary + action items, presence.

## Routes

`/messages` (Personal) · `/w/<workspaceId>` · `/home` · `/explore` · `/notifications` ·
`/profile` · `/u/<username>` · `/settings`, plus `?chatId=` / `?threadId=` deep links. View switches use `history.pushState`
so the chat list and realtime stream stay mounted.

## Getting started

1. Copy `.env.example` → `.env.local` and set `MONGODB_URI` (include a database name in
   the URI path) and `JWT_SECRET`. Storage keys are optional; without them uploads go to
   `public/uploads/`. Set `HARAKUMO_API_KEY` to enable email sign-in codes, password resets
   and address verification (without it those three flows return a clear "email unavailable"
   error; password sign-in is unaffected).
2. Collections and indexes are provisioned automatically on first connect
   (`src/lib/provision.ts`). To run it standalone: `npm run db:provision`.
3. Start the dev server:

```bash
npm run dev
```

> If styling ever looks raw/unstyled in dev, the Turbopack cache predates
> `postcss.config.mjs` — stop the server, `rm -rf .next`, and start again.

## Run heywasp on Harakumo

heywasp is open source (MIT) and is published on [Nucleus](https://nucleus.harakumo.com/-/explore),
Harakumo's code home. Its email sign-in codes, password resets and address checks already
go through Harakumo Mail (`src/lib/harakumo.ts`, one `HARAKUMO_API_KEY`).

heywasp is a Node server (Next.js standalone output, `sharp`, `ffmpeg` for video, `heic-convert`),
so on Harakumo it runs as a **server app** (Pro plan and up), not a static site.

1. **Create a project** at [harakumo.com/dashboard](https://harakumo.com/dashboard) → Projects → New project.
2. **Create an API key** (Settings → API keys) and add it to the project's environment as
   `HARAKUMO_API_KEY`. Turn on Mail for the project, or the email flows answer "email unavailable".
3. **Add the rest of the environment** (Project → Environment), from `.env.example`:
   - `MONGODB_URI` — a MongoDB database (include the database name in the path). heywasp
     stores its data in MongoDB today; a version on Harakumo's own database is planned.
   - `JWT_SECRET` — a long random string (`openssl rand -hex 32`).
   - Media storage: the S3-compatible values in `.env.example` (bucket, keys, endpoint, public URL).
     Uploads must go to object storage in production: a server app's disk is not kept between deploys.
   - Optional: `NEXT_PUBLIC_APP_URL`, TURN credentials for calls behind strict networks, and
     `VAPID_*` for web push.
4. **Deploy** from a folder with the CLI, or ask your AI assistant with the Harakumo connector:

   ```bash
   npm i -g @harakumo/cli
   harakumo login --key <your API key>
   harakumo deploy <project id> .
   ```

   Every deploy is saved as a commit in the project's private Nucleus repo.

Notes:

- **Real-time** is server-sent events (`/api/messages/sync`); the client reconnects after 3 s,
  so a redeploy drops streams for a moment and nobody loses messages.
- **Your MongoDB must accept the server's connections**: allow its address range, and use a
  database user limited to this database with a long password.
- **Rate limits:** `src/proxy.ts` limits sign-up, password sign-in, code requests, password
  reset and the contact form per IP, in the server's memory. Sign-in codes are also capped per
  address in the database.
- **Backups:** `POST /api/internal/backup` dumps every collection to your storage bucket and keeps
  14. Call it once a day from any scheduler with the `x-backup-key` header, whose value is
  `node -e "console.log(require('crypto').createHmac('sha256', process.env.JWT_SECRET).update('wasp-backup-v1').digest('hex'))"`
  run with your `JWT_SECRET` set.
- **Memory:** about 180 MB idle, ~330 MB with the image-safety model loaded, up to ~760 MB while
  transcoding 1080p video.

## API surface

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/auth/{signup,login,logout,me,profile,search}` | POST/GET/PUT | Auth, profile, user search |
| `/api/chats` | GET/POST/PATCH | List, create, rename chats/groups |
| `/api/chats/members` | GET/POST/DELETE/PATCH | Members: list, add, remove, promote |
| `/api/chats/summarize` | GET | AI summary |
| `/api/workspaces` | GET/POST/PATCH | My workspaces, create, update |
| `/api/workspaces/directory` | GET | Public workspace directory (`?q=`) |
| `/api/workspaces/join` | POST | Join by `workspaceId` (public) or `inviteCode` |
| `/api/workspaces/channels` | GET/POST/PATCH | List, create, (re)join channels |
| `/api/messages` | GET/POST/PATCH/DELETE | History, send, edit, delete |
| `/api/messages/{react,pin,threads}` | POST/GET | Reactions, pins, threads |
| `/api/messages/sync` | GET (SSE) | Realtime stream |
| `/api/typing` | POST | Typing signal |
| `/api/calls`, `/api/calls/signal` | GET/POST/DELETE | Call lifecycle & signalling |
| `/api/calls/leave` | POST | `sendBeacon` alias of `DELETE /api/calls` (tab close) |
| `/api/posts`, `/api/posts/[id]` | GET/POST/PATCH | Feed, create, like/repost/bookmark |
| `/api/posts/[id]/comments`, `…/[commentId]` | GET/POST/PATCH/DELETE | Comments + moderation |
| `/api/follow`, `/api/follow/requests` | GET/POST | Follow / request / accept / decline |
| `/api/users?username=` | GET | Public profile card + relationship |
| `/api/workspaces/members` | GET/PATCH/DELETE | Workspace members, roles, leave/remove |
| `/api/auth/switch` | POST | Switch active account (saved session token) |
| `/api/auth/otp/{request,verify}` | POST | Passwordless sign-in by emailed code |
| `/api/auth/password/{forgot,reset}` | POST | Emailed reset link → set a new password |
| `/api/auth/email/verify` | POST | `request` / `confirm` an email verification code |
| `/api/reports` | POST | Report a post/comment/user (3 reports auto-hide a post) |
| `/api/notifications` | GET | Notifications |
| `/api/chats/discover` | GET/POST | Find & join public groups |
| `/api/media/upload` | POST | Upload → media pipeline (dedupe, optimise, transcode) |
| `/api/media/proxy` | GET | Same-origin read of an uploaded file for in-app previews |

The full contract is in `openapi.yaml`.

## Stack

- Next.js 16 (App Router, Turbopack) · React 19 · TypeScript
- Tailwind CSS v4 on a CSS-variable token system (`src/app/globals.css`) — light default,
  dark via `[data-theme]` or `prefers-color-scheme`; `motion` for animation
- MongoDB — `users`, `chats`, `members`, `messages`, `updates`, `sessions`, `workspaces`,
  `workspace_members`, `media_assets`, `posts`, `comments`, `post_interactions`, `follows`,
  `follow_requests`, `reports`, `auth_codes`, `notifications`, `calls`, `signaling_updates`
- `sharp` (+ `heic-convert` fallback) for images; `ffmpeg` (optional, in the Docker image) for video
- Lazy-loaded preview renderers: react-markdown, highlight.js, mermaid, SheetJS, mammoth, epub.js
- JWT auth in an httpOnly cookie · S3-compatible object storage for media · WebRTC for
  calls · SSE for realtime

## Project layout

```
src/
  app/            routes, API handlers, globals.css, icon.svg
  components/
    WaspShell     app frame: icon rail (views + workspaces) and active view
    ChatWorkspace conversation UI — scoped to Personal or one workspace
    WorkspaceSwitcher               rail dropdown: Personal + all workspaces
    WorkspaceModal / ChannelModal   discover · create · join
    PostMedia + previews/           composer attachments and per-format renderers
    ThemeProvider / ThemeToggle     light · dark · system
    WaspMark      brand mark
  hooks/useChatSync   SSE client
  lib/            mongodb, provision, jwt, avatar, workspace helpers, db types
```
