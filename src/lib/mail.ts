/**
 * Transactional email, sent through Harakumo Mail (`./harakumo.ts`, one
 * `HARAKUMO_API_KEY`). Add your own domain in Harakumo → Mail to send from
 * it; until then mail goes out from Harakumo's shared sender.
 *
 * Server-side only: never import this from a client component.
 */

import { sendViaHarakumo, isHarakumoConfigured } from "./harakumo";

export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailError";
  }
}

export interface SendResult {
  status: string;
  messageId: string;
  provider: "harakumo";
}

/** The display name every WASP email carries. */
export const MAIL_FROM_NAME = "Hey WASP";
/**
 * Where contact-form messages are sent (they are also saved for the admin
 * dashboard). Set CONTACT_EMAIL to your own inbox; empty sends nothing.
 */
export const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "";

export function isMailConfigured(): boolean {
  return isHarakumoConfigured();
}

/** Which transport a send would use right now — surfaced by the admin dashboard. */
export function mailProvider(): "harakumo" | "none" {
  return isHarakumoConfigured() ? "harakumo" : "none";
}

/**
 * Send one transactional email. Plain text only — the most deliverable shape
 * for security codes.
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<SendResult> {
  if (!isHarakumoConfigured()) {
    throw new MailError("No email transport is configured — cannot send email.");
  }

  try {
    const r = await sendViaHarakumo({ ...opts, fromName: MAIL_FROM_NAME });
    return { status: r.status, messageId: r.messageId, provider: "harakumo" };
  } catch (err) {
    throw err instanceof MailError
      ? err
      : new MailError(err instanceof Error ? err.message : "Mail send failed");
  }
}

/* =========================================================================
   Templates — plain text, one purpose each.
   ========================================================================= */

const SIGNOFF = "\n\n— WASP\nIf you weren't expecting this email, you can safely ignore it.";

export function otpLoginEmail(code: string, minutes: number) {
  return {
    subject: `${code} is your WASP sign-in code`,
    text:
      `Your WASP sign-in code is:\n\n    ${code}\n\n` +
      `It expires in ${minutes} minutes and can only be used once.\n\n` +
      `If you didn't try to sign in, someone may have typed your email by mistake — ` +
      `no action is needed, and your account is safe.` +
      SIGNOFF,
  };
}

export function passwordResetEmail(link: string, minutes: number) {
  return {
    subject: "Reset your WASP password",
    text:
      `Someone asked to reset the password for your WASP account.\n\n` +
      `Open this link to choose a new one:\n\n${link}\n\n` +
      `The link expires in ${minutes} minutes and works only once.\n\n` +
      `If you didn't request this, ignore this email — your password stays as it is.` +
      SIGNOFF,
  };
}

export function emailVerifyEmail(code: string, minutes: number) {
  return {
    subject: `${code} is your WASP verification code`,
    text:
      `Confirm this email address for your WASP account with the code:\n\n    ${code}\n\n` +
      `It expires in ${minutes} minutes.\n\n` +
      `Verifying your email is what lets you sign in with a code and reset your password.` +
      SIGNOFF,
  };
}

export function welcomeEmail(displayName: string, username: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://heywasp.com";
  return {
    subject: "Welcome to WASP 🐝",
    text:
      `Hey ${displayName},\n\n` +
      `Your WASP account is ready — you're @${username}.\n\n` +
      `WASP is one app for the way people actually talk:\n` +
      `  • Personal chats with the people you know\n` +
      `  • Workspaces and channels for the teams you build\n` +
      `  • HD calls and screen sharing when typing isn't enough\n` +
      `  • Waspmoji — our own emoji, only on WASP\n\n` +
      `Open WASP: ${appUrl}\n\n` +
      `Tip: install it as an app from your browser menu and calls will reach ` +
      `you even when the browser is closed.\n\n` +
      `Questions? Use the contact form at ${appUrl}/contact — a real person reads it.` +
      SIGNOFF,
  };
}

/** Sent to the team inbox when someone uses the contact form. */
export function contactNotificationEmail(msg: {
  name: string;
  email: string;
  message: string;
}) {
  return {
    subject: `New contact form message from ${msg.name}`,
    text:
      `${msg.name} <${msg.email}> wrote:\n\n${msg.message}\n\n` +
      `— Reply straight to ${msg.email}.`,
  };
}
