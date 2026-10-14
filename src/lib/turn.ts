/**
 * Short-lived TURN credentials from a hosted TURN service.
 *
 * TURN_CREDENTIALS_URL is the service's credential endpoint: it takes a POST
 * of { ttl } with a bearer token and answers { iceServers }. The token must
 * never reach a browser, so the exchange happens here: we ask for 24h ice servers and hand them to the client in
 * the /api/calls response. Cached for an hour per process — credentials are
 * per-fetch, not per-user, and a call joining should not cost an extra
 * round-trip more often than that.
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const CRED_TTL_SECONDS = 86_400;
const CACHE_MS = 60 * 60 * 1000;

let cached: { servers: IceServer[]; at: number } | null = null;

export async function getTurnIceServers(): Promise<IceServer[] | null> {
  const credentialsUrl = process.env.TURN_CREDENTIALS_URL;
  const apiToken = process.env.TURN_API_TOKEN;
  if (!credentialsUrl || !apiToken) return null; // TURN not configured — STUN-only fallback

  if (cached && Date.now() - cached.at < CACHE_MS) return cached.servers;

  try {
    const res = await fetch(
      credentialsUrl,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: CRED_TTL_SECONDS }),
      }
    );
    if (!res.ok) throw new Error(`TURN credential API returned ${res.status}`);
    const data = (await res.json()) as { iceServers?: IceServer[] };
    if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) {
      throw new Error("TURN credential API returned no iceServers");
    }
    cached = { servers: data.iceServers, at: Date.now() };
    return data.iceServers;
  } catch (err) {
    // A relay outage must not block calls — they fall back to STUN.
    console.error("TURN credentials unavailable:", err);
    return cached?.servers ?? null;
  }
}
