import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-IP limits on the unauthenticated auth and contact endpoints.
 *
 * Sign-in codes and reset emails are also capped per address in the database
 * (lib/auth-codes.ts); this is the layer that stops one address hammering
 * password sign-in or sign-up. Held in this process's memory, so it is exact
 * for one server and per-instance if you run several.
 */

const LIMITS: Record<string, { limit: number; windowMs: number }> = {
  // Carrier NAT means real users share IPs — generous enough for a launch
  // party, useless for a bot farm.
  "/api/auth/signup": { limit: 15, windowMs: 3_600_000 },
  "/api/auth/login": { limit: 30, windowMs: 600_000 },
  "/api/auth/otp/request": { limit: 5, windowMs: 900_000 },
  "/api/auth/password/forgot": { limit: 5, windowMs: 900_000 },
  // Public, unauthenticated — the classic spam target.
  "/api/contact": { limit: 5, windowMs: 3_600_000 },
};

const windows = new Map<string, { n: number; resetAt: number }>();
let lastSweep = 0;

/** The caller's address as the platform forwards it; best effort. */
function clientIp(request: NextRequest): string {
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "unknown";
}

export function proxy(request: NextRequest) {
  if (request.method !== "POST") return NextResponse.next();
  const rule = LIMITS[request.nextUrl.pathname];
  if (!rule) return NextResponse.next();

  const now = Date.now();
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [key, w] of windows) if (now > w.resetAt) windows.delete(key);
  }

  const key = `${request.nextUrl.pathname}|${clientIp(request)}`;
  let w = windows.get(key);
  if (!w || now > w.resetAt) {
    w = { n: 0, resetAt: now + rule.windowMs };
    windows.set(key, w);
  }
  w.n++;
  if (w.n <= rule.limit) return NextResponse.next();

  return NextResponse.json(
    { error: "Too many attempts — please wait a bit and try again." },
    { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((w.resetAt - now) / 1000))) } }
  );
}

export const config = {
  matcher: ["/api/auth/:path*", "/api/contact"],
};
