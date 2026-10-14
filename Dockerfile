# syntax=docker/dockerfile:1

# ---- deps -------------------------------------------------------------------
# Node 22: Node 20 is past end-of-life, and this matches the local dev runtime
# so the lockfile resolves identically in both places.
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- builder ----------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* are inlined into the client bundle by `next build`, so they must
# arrive as build args. Setting them as runtime env on the container is too late
# to change anything the browser ever sees.
ARG NEXT_PUBLIC_APP_URL=""
ARG NEXT_PUBLIC_TURN_URL=""
ARG NEXT_PUBLIC_TURN_USERNAME=""
ARG NEXT_PUBLIC_TURN_CREDENTIAL=""
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_TURN_URL=$NEXT_PUBLIC_TURN_URL \
    NEXT_PUBLIC_TURN_USERNAME=$NEXT_PUBLIC_TURN_USERNAME \
    NEXT_PUBLIC_TURN_CREDENTIAL=$NEXT_PUBLIC_TURN_CREDENTIAL

ENV NEXT_TELEMETRY_DISABLED=1

# No secrets are present here on purpose — the build must stay hermetic. That
# works because the Mongo client connects lazily on first request, not at import.
RUN npm run build

# ---- runner -----------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

# ffmpeg powers the background video optimisation (poster + 720p H.264 rendition).
# The app degrades gracefully (serves originals) if it is absent.
RUN apk add --no-cache ffmpeg

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Wraps Next's server.js with a SIGTERM handler. Next waits for in-flight
# requests to drain on shutdown, and this app's SSE streams never drain on their
# own — without this every rollout stalls until the platform SIGKILLs.
COPY --chown=nextjs:nodejs docker/server-entry.js ./server-entry.js

# sharp's native libvips binaries are loaded through a runtime `require` that
# Next's output-file tracing does not always follow, so copy them in explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@img ./node_modules/@img

USER nextjs

EXPOSE 8080

CMD ["node", "server-entry.js"]
