import type { Metadata } from "next";
import {
  Bell,
  FileText,
  LayoutGrid,
  MessageSquare,
  MonitorSmartphone,
  ShieldCheck,
  Video,
} from "lucide-react";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/MarketingChrome";
import AuthNav from "@/components/marketing/AuthNav";

export const metadata: Metadata = {
  title: "WASP — Say hey to your team",
  description:
    "Personal chats, team workspaces and HD calls in one fast app. Messages, channels, file previews, push notifications — free on heywasp.com.",
  openGraph: {
    title: "WASP — Say hey to your team",
    description: "Personal chats, team workspaces and HD calls in one fast app.",
    url: "https://heywasp.com",
    siteName: "WASP",
    type: "website",
  },
};

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Messaging that feels instant",
    body: "Personal chats and groups with edits, reactions, replies, threads and read receipts — delivered in real time, in order, every time.",
  },
  {
    icon: LayoutGrid,
    title: "Workspaces for every team",
    body: "Slack-style channels with invite links and roles. Workspaces are private by default — people join when you invite them, and land in your channels instantly.",
  },
  {
    icon: Video,
    title: "Calls that just connect",
    body: "HD video and audio calls with screen sharing. A global relay network gets you connected even on strict office or mobile networks.",
  },
  {
    icon: FileText,
    title: "Every file previews inline",
    body: "PDF, Word, Excel, Markdown, code, CSV, EPUB — shared files render right inside the conversation. No downloads to see what you were sent.",
  },
  {
    icon: Bell,
    title: "Never miss a message",
    body: "Push notifications reach your phone even when WASP is closed — new messages and incoming calls buzz through like a native app.",
  },
  {
    icon: ShieldCheck,
    title: "Safe by default",
    body: "Automatic image moderation, private accounts with follow requests, report tools and nightly backups. Your community stays yours.",
  },
];

export default function Landing() {
  return (
    <main className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)]">
      <MarketingHeader />

      {/* ---------- Hero ---------- */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-14 text-center sm:pt-20">
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
          Say <span className="text-[var(--accent)]">hey</span> to your team.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-[var(--text-secondary)]">
          WASP is one fast app for the way people actually talk — personal chats
          with the people you know, workspaces for the teams you build, and HD
          calls when typing isn&apos;t enough.
        </p>
        <div className="mt-8">
          <AuthNav variant="hero" />
        </div>
        <p className="mt-4 text-sm text-[var(--text-muted)]">
          Free to use · No credit card · Installs on any device
        </p>

        {/* Product vignette: an honest sketch of the app, drawn with the app's own tokens. */}
        <div className="mx-auto mt-14 max-w-3xl overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] text-left shadow-[0_20px_60px_-30px_rgba(29,78,216,0.35)]">
          <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--danger)] opacity-60" aria-hidden />
            <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b] opacity-60" aria-hidden />
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-online)] opacity-60" aria-hidden />
            <span className="ml-3 text-xs font-semibold text-[var(--text-muted)]">#launch-day · WASP</span>
          </div>
          <div className="space-y-4 px-5 py-6">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-muted)] text-xs font-bold text-[var(--accent)]">A</span>
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)]">Aisha · 9:41 AM</p>
                <p className="mt-1 rounded-2xl rounded-tl-sm bg-[var(--layer-1)] px-4 py-2.5 text-sm">
                  Design review in 5 — hopping on a call 🎥
                </p>
              </div>
            </div>
            <div className="flex items-start justify-end gap-3">
              <div className="text-right">
                <p className="text-xs font-semibold text-[var(--text-muted)]">You · 9:42 AM</p>
                <p className="mt-1 rounded-2xl rounded-tr-sm bg-[var(--accent)] px-4 py-2.5 text-sm text-[var(--text-on-accent)]">
                  On my way — sharing the specs here 📎 specs-v2.pdf
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 pl-11 text-xs font-medium text-[var(--text-muted)]">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-online)]" aria-hidden />
              Aisha is typing…
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Product video ---------- */}
      <section id="demo" className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-16">
        <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
          See WASP in 60 seconds
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-[var(--text-secondary)]">
          One minute, sound on — everything WASP does, from chats to calls to
          Waspmoji.
        </p>
        <div className="mx-auto mt-10 max-w-4xl overflow-hidden rounded-2xl border border-[var(--border-color)] bg-black shadow-[0_20px_60px_-30px_rgba(29,78,216,0.35)]">
          {/* preload="none" keeps the 9MB video off the wire until someone hits play */}
          <video
            controls
            playsInline
            preload="none"
            poster="/media/wasp-launch-poster.jpg"
            className="block h-auto w-full"
          >
            <source src="/media/wasp-launch.mp4" type="video/mp4" />
          </video>
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section id="features" className="scroll-mt-20 border-t border-[var(--border-color)] bg-[var(--bg-surface)]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            Everything a team needs to talk
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-[var(--text-secondary)]">
            One app instead of four — chat, channels, calls and a feed your
            community actually enjoys.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-app)] p-6 transition-colors duration-200 hover:border-[var(--border-color-active)]"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent-muted)] text-[var(--accent)]">
                  <f.icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-4 text-base font-bold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:py-20">
        <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Up and running in two minutes</h2>
        <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-3">
          {[
            { n: "1", t: "Create your space", b: "Sign up free and start a workspace — it comes with #general and #random ready to go." },
            { n: "2", t: "Invite your people", b: "Send one invite link. Only people you invite can join — your workspace is never listed publicly." },
            { n: "3", t: "Talk, call, share", b: "Chat in channels and DMs, jump on HD calls, post to your feed — everything in one place." },
          ].map((step) => (
            <div key={step.n} className="text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)] text-lg font-bold text-[var(--text-on-accent)]">{step.n}</span>
              <h3 className="mt-4 text-base font-bold">{step.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">{step.b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Why WASP ---------- */}
      <section id="why-wasp" className="scroll-mt-20 border-t border-[var(--border-color)] bg-[var(--bg-surface)]">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Why we built WASP</h2>
            <p className="mt-5 leading-relaxed text-[var(--text-secondary)]">
              Most teams live split across four apps: one for work channels, one for personal
              chats, one for calls, one for sharing. Every message means deciding where it
              belongs — and someone always misses it.
            </p>
            <p className="mt-4 leading-relaxed text-[var(--text-secondary)]">
              WASP keeps those worlds together but never mixed: your personal chats stay
              personal, each workspace keeps its own channels, and one tap moves you between
              them. Calls, file previews, posts and notifications work the same everywhere.
            </p>
            <p className="mt-4 leading-relaxed text-[var(--text-secondary)]">
              It&apos;s built on a global edge network, which is a technical way of saying:
              messages arrive instantly, calls connect even on hotel Wi-Fi, and the app feels
              quick from anywhere on earth. Free to use, no ads, and your content is never
              sold or used to train AI.
            </p>
          </div>
          <div className="mx-auto mt-10 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Free", "no ads, no card"],
              ["HD", "720p calls"],
              ["12+", "file types preview"],
              ["4", "platforms, one app"],
            ].map(([big, small]) => (
              <div key={big} className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-app)] p-5 text-center">
                <p className="text-2xl font-extrabold text-[var(--accent)]">{big}</p>
                <p className="mt-1 text-xs font-medium text-[var(--text-muted)]">{small}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Install anywhere ---------- */}
      <section id="install" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 sm:py-20">
        <div className="flex flex-col items-center gap-8 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] px-6 py-10 text-center sm:px-12">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-muted)] text-[var(--accent)]">
            <MonitorSmartphone className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Installs on everything you own</h2>
            <p className="mx-auto mt-3 max-w-xl text-[var(--text-secondary)]">
              iPhone, Android, Mac and Windows — add WASP from your browser and it
              lives on your home screen or dock like any other app, notifications
              included. No app store required.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-semibold text-[var(--text-muted)]">
            <span>iPhone</span><span aria-hidden>·</span>
            <span>Android</span><span aria-hidden>·</span>
            <span>Mac</span><span aria-hidden>·</span>
            <span>Windows</span>
          </div>
        </div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="border-t border-[var(--border-color)] bg-[var(--bg-surface)]">
        <div className="mx-auto max-w-6xl px-5 py-16 text-center sm:py-20">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Your team is one <span className="text-[var(--accent)]">hey</span> away
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[var(--text-secondary)]">
            Create an account, start a workspace, invite your people. Two minutes, free.
          </p>
          <div className="mt-8">
            <AuthNav variant="cta" />
          </div>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
