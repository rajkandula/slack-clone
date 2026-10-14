"use client";

import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [hp, setHp] = useState(""); // honeypot — humans never see it
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message, company: hp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send — please try again.");
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send — please try again.");
      setState("idle");
    }
  };

  if (state === "sent") {
    return (
      <div className="mt-8 flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
        <MailCheck className="h-5 w-5 shrink-0 text-[var(--color-online)]" aria-hidden />
        <p className="text-sm text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">Message sent.</strong> Thanks for reaching out — we read everything and reply to {email || "your email"}.
        </p>
      </div>
    );
  }

  const field =
    "w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]";

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="c-name" className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">Your name</label>
          <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} className={field} />
        </div>
        <div>
          <label htmlFor="c-email" className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">Email</label>
          <input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} className={field} />
        </div>
      </div>
      <div>
        <label htmlFor="c-msg" className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">How can we help?</label>
        <textarea id="c-msg" value={message} onChange={(e) => setMessage(e.target.value)} required rows={6} maxLength={4000} className={field} />
      </div>
      <input type="text" value={hp} onChange={(e) => setHp(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" name="company" />
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <button
        type="submit"
        disabled={state === "busy"}
        className="flex cursor-pointer items-center gap-2 rounded-xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-[var(--text-on-accent)] transition-colors duration-200 hover:bg-[var(--accent-hover)] disabled:opacity-60"
      >
        {state === "busy" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Send message
      </button>
    </form>
  );
}
