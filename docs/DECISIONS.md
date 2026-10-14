# Decisions

One entry per decision that can be seen in the code and README. This repo's history
starts with the open-source release commit on 2026-10-13, so entries carry that date.
Where code comments describe an earlier behaviour, the entry says so without guessing
when it changed. Where the reasoning is not written down anywhere, the entry says that
too.

## 1. One Next.js server for pages, API and realtime

- **Date:** 2026-10-13
- **Decision:** Build everything as one Next.js 16 app (App Router, React 19,
  TypeScript) with `output: "standalone"`, shipped as a Docker image that runs a
  single Node process.
- **Options weighed:** A static site plus serverless functions; a separate API
  service. The README says that on Harakumo it runs as a server app, not a
  static site.
- **Why:** The app needs a long-lived Node process: `sharp`, `heic-convert` and
  `ffmpeg` for media, an in-process image classifier, and SSE responses that stay
  open. One deployable keeps self-hosting to one container plus a database and a bucket.

## 2. MongoDB, with the schema provisioned by the app

- **Date:** 2026-10-13
- **Decision:** Store everything in MongoDB. `src/lib/provision.ts` creates missing
  collections, applies `$jsonSchema` validators and ensures indexes on first
  connect; `npm run db:provision` does the same by hand.
- **Options weighed:** A SQL database with migrations. The README says a version on
  Harakumo's own database is planned; MongoDB is what ships today.
- **Why:** Chats, messages with reactions and post attachments are document-shaped,
  and self-provisioning means a fresh database works with no migration step.
  Validators keep the main collections' shapes enforced.

## 3. Identity stays in MongoDB; Harakumo is the email channel only

- **Date:** 2026-10-13
- **Decision:** Keep user accounts in the `users` collection with bcrypt hashes, and
  use Harakumo only to send email (`src/lib/harakumo.ts`, one `HARAKUMO_API_KEY`).
- **Options weighed:** Harakumo Auth pools.
- **Why:** As the README and `harakumo.ts` state, every collection references a
  MongoDB user `_id`, and Auth pools offer no emailed sign-in codes or password reset.

## 4. Stateless JWT sessions in an httpOnly cookie

- **Date:** 2026-10-13
- **Decision:** Sign a JWT (`JWT_SECRET`, 7 days) and set it as the `token` cookie:
  httpOnly, `SameSite=Lax`, `Secure` in production. The token is also returned in
  the response body so the client can offer multi-account switching.
- **Options weighed:** Server-side sessions. A `sessions` collection is provisioned
  but never used.
- **Why:** Not recorded in the code. The effect is that each request only verifies
  the signature and loads the user; the cost is that a token cannot be revoked
  before it expires (see SYSTEM-DESIGN.md, Security).

## 5. Emailed codes are hashed, single-use and rate-limited

- **Date:** 2026-10-13
- **Decision:** Sign-in codes, reset links and verification codes are stored only as
  HMAC-SHA256 hashes in `auth_codes`, deleted on use, expired by query and by a TTL
  index, burned after 5 wrong guesses, and limited to 3 sends per address per 15
  minutes. Request endpoints answer the same whether or not an account exists.
- **Options weighed:** Plaintext codes; no per-address cap.
- **Why:** From `src/lib/auth-codes.ts`: a database leak alone cannot reveal a code,
  guessing cannot continue, and the mailbox "can't be used as a weapon".

## 6. Realtime over Server-Sent Events backed by a MongoDB poll

- **Date:** 2026-10-13
- **Decision:** One `EventSource` per tab to `/api/messages/sync`. The server polls
  MongoDB every 1.5 s per stream for new messages, edits, typing, presence and call
  signals. The loop re-arms only after a pass completes.
- **Options weighed:** WebSockets (the call client can use a `/ws/rtc` WebSocket hub
  as a fast path, but the hub is not shipped); MongoDB change streams (not used).
- **Why:** Plain HTTP that any host can serve, with all state in MongoDB, so any
  instance can deliver any message and a redeploy only drops streams for the 3 s
  the client waits before reconnecting. The comments explain the self-scheduling
  loop: `setInterval` with an async callback overlapped and flooded the connection
  pool. The cost is polling load that grows with open tabs (SYSTEM-DESIGN.md, How it scales).

## 7. Per-chat sequence numbers and idempotent sends

- **Date:** 2026-10-13
- **Decision:** Each send increments `chats.maxSeq` atomically and stamps the message
  with it; a client-generated `clientMsgId` with a unique sparse index makes retries
  return the stored message.
- **Options weighed:** Ordering by timestamp only.
- **Why:** The SSE loop streams "everything above my pointer" per chat, which needs
  a gap-free, monotonic order; retries on flaky networks must not duplicate messages.

## 8. Personal chats and workspaces are separate containers

- **Date:** 2026-10-13
- **Decision:** DMs and personal groups live outside any workspace; channels and
  workspace groups carry a `workspaceId`. DMs are global, one thread per pair. The
  sidebar shows one container at a time.
- **Options weighed:** Per-workspace DMs (as in Slack).
- **Why:** The README: so "it is always obvious where a message goes".

## 9. Workspaces are invite-only and are the access model

- **Date:** 2026-10-13
- **Decision:** Workspaces are always created private and joined only by invite
  code. Finding, messaging, following, viewing profiles and seeing posts all require
  sharing a workspace (`src/lib/workspace-access.ts`). Existing DMs and follows are
  never revoked, only new ones gated.
- **Options weighed:** A public workspace directory with self-join, which the code
  comments describe as the earlier behaviour. `/api/workspaces/directory` keeps its
  shape but now returns only your own workspaces.
- **Why:** From the comments: "a company's member list is not something a stranger
  should be able to walk into", and knowing a workspace id "must never be enough to
  walk into a company's conversations". The README's Product model and API table
  still mention the public directory; the code is invite-only.

## 10. Calls are peer-to-peer WebRTC with signalling through the database

- **Date:** 2026-10-13
- **Decision:** A mesh of `RTCPeerConnection`s, one per other participant. Offers,
  answers and candidates are stored in `signaling_updates` and delivered over SSE.
  One active call per chat is enforced by a partial unique index; participants'
  SSE loops heartbeat the call and stale calls are ended after 30 s.
- **Options weighed:** A media server (not built); a WebSocket signalling hub (client
  support only).
- **Why:** No extra service to run. The comments record the reasons for the guards:
  two people dialling at once used to create two empty calls, and a crashed tab
  used to leave an `active` call that later callers silently joined.

## 11. TURN credentials are fetched by the server

- **Date:** 2026-10-13
- **Decision:** `/api/calls` exchanges `TURN_API_TOKEN` at `TURN_CREDENTIALS_URL` for
  24-hour ICE servers, caches them for an hour and returns them with the call.
  Static `NEXT_PUBLIC_TURN_*` values remain as an override. Without either, calls
  use STUN only.
- **Options weighed:** Static TURN credentials baked into the client bundle.
- **Why:** From `src/lib/turn.ts`: the token "must never reach a browser", and a relay
  outage "must not block calls".

## 12. S3-compatible object storage, local disk only in development

- **Date:** 2026-10-13
- **Decision:** Uploads go to any S3-compatible bucket configured by five `STORAGE_*`
  variables. Without them, development writes to `public/uploads/` and production
  refuses the upload.
- **Options weighed:** Falling back to local disk everywhere.
- **Why:** From `media-pipeline.ts`: a container's disk is ephemeral, so a local
  fallback in production would return URLs that 404 after a restart, "silent data
  loss discovered hours later".

## 13. One content-addressed media pipeline, run in-process

- **Date:** 2026-10-13
- **Decision:** Every upload becomes one `media_assets` row keyed by its SHA-256, so
  re-uploads and forwards never store a second copy. Images get EXIF rotation,
  HEIC to JPEG, a WebP display copy and a thumbnail; videos get a poster and a
  background H.264 rendition with ffmpeg limited to 2 threads.
- **Options weighed:** An external transcoding service. Not recorded beyond the code.
- **Why:** From the comments: the transcode runs "inside the same container that is
  serving every open SSE stream", so it is bounded to avoid memory spikes and a
  starved event loop. Without ffmpeg, originals are served.

## 14. Uploads can never be served as pages

- **Date:** 2026-10-13
- **Decision:** Executables are refused. HTML, JavaScript and script files are stored
  as `text/plain`. `/api/media/proxy` serves only our own upload URLs as `text/plain`
  or `application/octet-stream` with `nosniff`. HTML previews render in an iframe
  with an empty `sandbox` attribute.
- **Options weighed:** Rejecting code and HTML uploads entirely.
- **Why:** From `post-media.ts`: uploads are served from a public bucket, and source
  code and HTML are useful to share and preview.

## 15. Self-hosted moderation that fails open

- **Date:** 2026-10-13
- **Decision:** Images and video posters are scored in-process by nsfwjs on
  TensorFlow.js: explicit is rejected, borderline is stored and blurred. Post and
  comment text is checked with `obscenity`. DMs are not filtered. Three reports
  hide a post. If the model cannot load, uploads are accepted unscanned.
- **Options weighed:** An external moderation API.
- **Why:** From `moderation.ts`: "no external API", "availability over false
  rejection", and DMs are "private speech" covered by the report tool instead.

## 16. Web push only reaches people the stream cannot

- **Date:** 2026-10-13
- **Decision:** VAPID web push goes only to participants whose SSE stream is not
  live, at most once per chat per 2 minutes (30 s for calls). The service worker
  handles push and has no fetch handler.
- **Options weighed:** Pushing every message; an offline cache in the service worker.
- **Why:** From `push.ts`: "an open tab never buzzes the phone in your pocket for a
  message you're looking at". From `sw.js`: a cache in front of a realtime app is
  "all risk, no reward".

## 17. App-level backups to the bucket

- **Date:** 2026-10-13
- **Decision:** `POST /api/internal/backup`, protected by an HMAC-derived key, dumps
  every collection as gzipped EJSON to the bucket and keeps the newest 14. An outside
  scheduler calls it daily.
- **Options weighed:** Relying on the database host's own backups.
- **Why:** The route's comment says the database tier in use keeps no backups. EJSON
  keeps ObjectIds and dates restorable.

## 18. Rate limits in process memory

- **Date:** 2026-10-13
- **Decision:** `src/proxy.ts` limits sign-up, password sign-in, code requests,
  password reset and the contact form per IP in a `Map`; emailed codes are also
  capped per address in the database.
- **Options weighed:** A shared rate-limit store or an edge limiter.
- **Why:** No extra service. The file states the trade-off: exact for one server,
  per-instance when several run.

## 19. Builds without secrets, and no unsafe secret fallback

- **Date:** 2026-10-13
- **Decision:** `MONGODB_URI` and `JWT_SECRET` are read on first use, not at import.
  In production a missing `JWT_SECRET` throws instead of using the development
  fallback in `src/lib/secret.ts`.
- **Options weighed:** Reading secrets at module scope.
- **Why:** From the comments: `next build` runs in Docker with no secrets, and a
  fallback secret sitting "in the public source tree" would let anyone mint a token
  for any account.

## 20. Force exit shortly after SIGTERM

- **Date:** 2026-10-13
- **Decision:** `docker/server-entry.js` wraps the standalone server and exits
  `SHUTDOWN_GRACE_MS` (default 5 s) after SIGTERM.
- **Options weighed:** Next's default shutdown, which waits for in-flight requests.
- **Why:** SSE streams never finish on their own, so every rollout would wait until
  the platform's kill timeout. Clients reconnect after 3 s.

## 21. The conversation summary is rule-based

- **Date:** 2026-10-13
- **Decision:** `GET /api/chats/summarize` picks action items and decisions from the
  last 100 messages by keywords ("todo", "need to", "agreed", "decided"...). No
  language model is called.
- **Options weighed:** Not recorded.
- **Why:** Not recorded. It needs no API key or outside service. The README and UI
  call it an "AI summary".

## 22. Open source under MIT

- **Date:** 2026-10-13
- **Decision:** Publish the code under the MIT licence (`LICENSE`) and on Nucleus,
  Harakumo's code home, as the README states.
- **Options weighed:** Not recorded.
- **Why:** The README presents heywasp as a project anyone can deploy themselves,
  including on Harakumo, whose Mail it already uses. No other reason is written down.

## 23. Vendor-neutral configuration

- **Date:** 2026-10-13
- **Decision:** Outside services are configured by generic names: `STORAGE_*` for
  "any S3-compatible bucket", `TURN_CREDENTIALS_URL` and `TURN_API_TOKEN` for "a
  hosted TURN service", plus `NEXT_PUBLIC_TURN_*` for a self-hosted relay.
- **Options weighed:** Settings tied to one storage or relay provider.
- **Why:** As `.env.example` and `src/lib/turn.ts` show, any provider that speaks the
  S3 API or the documented credential exchange works, so self-hosters choose.

## 24. Security fixes made before publishing

- **Date:** 2026-10-13 (the comments record the fixes; the history does not show
  when each was made)
- **Decision:** Close access holes found in the code. The comments describe these:
  - `canViewPost` lacked the private-account gate, so a non-follower could read the
    comments on a private account's public post (`src/lib/post-access.ts`).
  - Posts are only visible inside shared workspaces, so a post id no longer leaks
    who commented.
  - Liking or reposting needs the same visibility check as reading, so a stranger
    cannot ping anyone by post id (`api/posts/[id]`).
  - Adding someone to a group needs a shared workspace, so an empty group can no
    longer be used to pull in any account (`api/chats/members`).
  - A call signal's recipient must be in the chat, so nobody can push an offer at an
    arbitrary user id (`api/calls/signal`).
  - Group discovery is limited to your workspaces instead of listing personal groups
    to everyone (`api/chats/discover`).
  - The workspace directory no longer lists other workspaces, and joining by
    workspace id was removed (`api/workspaces/directory`, `api/workspaces/join`).
  - The caller name on an incoming call is read from `users`, not from what the
    sender posted (`api/messages/sync`).
  - Production refuses the development JWT secret (`src/lib/secret.ts`).
- **Options weighed:** Not recorded.
- **Why:** These were reachable by any signed-in account. Gaps still open are
  listed in SYSTEM-DESIGN.md under Security.
