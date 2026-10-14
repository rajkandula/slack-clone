import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy — WASP" };

const H = "mt-10 text-xl font-bold";
const P = "mt-3 leading-relaxed text-[var(--text-secondary)]";

export default function Privacy() {
  return (
    <article>
      <h1 className="text-3xl font-extrabold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">Last updated: August 2026</p>
      <p className={P}>
        WASP (heywasp.com) is a messaging and community app. This page explains, in plain
        language, what we store and why. The short version: we store what the product needs
        to work, we don&apos;t sell it, and you can leave with your data deleted.
      </p>

      <h2 className={H}>What we collect</h2>
      <p className={P}>
        <strong className="text-[var(--text-primary)]">Account details</strong> — username, display name, email address, profile photo
        and bio. <strong className="text-[var(--text-primary)]">Content you create</strong> — messages, posts, comments, and files you
        upload (images, video, documents). <strong className="text-[var(--text-primary)]">Product signals</strong> — presence
        (online/last seen), read state, and, if you enable notifications, a push subscription
        for your device. Passwords are stored only as salted hashes; sign-in codes are stored
        only as keyed hashes and expire within minutes.
      </p>

      <h2 className={H}>What we do with it</h2>
      <p className={P}>
        Deliver your messages, ring your calls, show your posts to the audience you chose,
        and notify your devices. That&apos;s it. We do not sell personal data, we do not show
        ads, and we do not use your content to train AI models.
      </p>

      <h2 className={H}>Calls</h2>
      <p className={P}>
        Voice and video travel directly between participants (or through a relay when your
        network requires one), encrypted in transit with standard WebRTC security (DTLS-SRTP).
        We never record calls; our servers only carry the small signalling messages that set
        a call up.
      </p>

      <h2 className={H}>Safety scanning</h2>
      <p className={P}>
        Uploaded images are automatically screened by a moderation model that runs on our own
        servers — nothing is sent to third-party analysis services. Clearly explicit content
        is rejected; borderline content is blurred behind a click-through.
      </p>

      <h2 className={H}>Who processes data for us</h2>
      <p className={P}>
        WASP runs on Harakumo (hosting and transactional email such as sign-in codes),
        MongoDB Atlas (database), an object storage provider (uploaded files) and a TURN
        relay for calls. Each processes
        data only to provide those services. Encrypted nightly backups are kept for 14 days.
      </p>

      <h2 className={H}>Your controls</h2>
      <p className={P}>
        You can make your account private, limit who sees each post, edit or delete your
        messages and posts, and disable notifications per device. To delete your account and
        its data entirely, contact us and we&apos;ll complete it within 30 days.
      </p>

      <h2 className={H}>Contact</h2>
      <p className={P}>
        Privacy questions: use the <a href="/contact" className="cursor-pointer font-semibold text-[var(--accent)] hover:underline">contact page</a> and
        we&apos;ll get back to you.
      </p>
    </article>
  );
}
