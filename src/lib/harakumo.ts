/**
 * Harakumo Mail — every email WASP sends (sign-in codes, resets, welcome).
 * Add your own domain in Harakumo → Mail to send from it.
 *
 * Identity stays in MongoDB, so Harakumo Auth pools are deliberately NOT used.
 * The API key is server-side only. Never import this from a client component.
 */

const API_BASE = "https://harakumo.com/api";
const SEND_TIMEOUT_MS = 15_000;

export function isHarakumoConfigured(): boolean {
  return !!process.env.HARAKUMO_API_KEY;
}

interface HarakumoResult {
  id: number;
  status: string;
  messageId: string;
}

export async function sendViaHarakumo(opts: {
  to: string;
  subject: string;
  text: string;
  fromName: string;
}): Promise<HarakumoResult> {
  const apiKey = process.env.HARAKUMO_API_KEY;
  if (!apiKey) {
    throw new Error("HARAKUMO_API_KEY is not configured — cannot send email.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}/mail/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        // The address is fixed (no-reply@harakumo.com), but the display name
        // should read as us, not the mail provider.
        fromName: opts.fromName,
        from: { name: opts.fromName },
      }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `Mail send failed (HTTP ${res.status})`);
    }

    const message = data?.message ?? {};
    if (message.status && message.status !== "sent" && message.status !== "queued") {
      throw new Error(message.error || `Mail was not sent (status: ${message.status})`);
    }

    return {
      id: message.id,
      status: message.status ?? "sent",
      messageId: message.message_id ?? "",
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("The email service timed out. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
