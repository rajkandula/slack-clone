import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service — WASP" };

const H = "mt-10 text-xl font-bold";
const P = "mt-3 leading-relaxed text-[var(--text-secondary)]";

export default function Terms() {
  return (
    <article>
      <h1 className="text-3xl font-extrabold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">Last updated: August 2026</p>
      <p className={P}>
        These terms keep WASP usable and safe for everyone. By creating an account on
        heywasp.com you agree to them.
      </p>

      <h2 className={H}>Your account</h2>
      <p className={P}>
        You must provide accurate information and keep your credentials to yourself.
        You&apos;re responsible for what happens under your account. One person per account.
      </p>

      <h2 className={H}>Your content</h2>
      <p className={P}>
        What you post stays yours. You give WASP only the permission needed to store,
        display and deliver it to the audience you chose — nothing more. Delete it and that
        permission ends (backups age out within 14 days).
      </p>

      <h2 className={H}>Acceptable use</h2>
      <p className={P}>
        Don&apos;t use WASP to harass, threaten or defraud people; to post sexually explicit,
        violent-extremist or illegal content; to spam; to impersonate others; or to probe,
        overload or abuse the service. Automated image screening, community reporting and
        rate limits enforce this, and we may remove content or suspend accounts that
        break these rules — severe cases without warning.
      </p>

      <h2 className={H}>The service</h2>
      <p className={P}>
        WASP is provided &quot;as is&quot;, free of charge, without warranties. We work hard to keep
        it fast and available (and back data up nightly), but we can&apos;t promise zero
        downtime or zero data loss, and we aren&apos;t liable for indirect damages arising
        from use of the service.
      </p>

      <h2 className={H}>Changes</h2>
      <p className={P}>
        We may update these terms as the product evolves; material changes will be announced
        in the app. Continuing to use WASP after a change means you accept it.
      </p>

      <h2 className={H}>Contact</h2>
      <p className={P}>
        Questions about these terms: the <a href="/contact" className="cursor-pointer font-semibold text-[var(--accent)] hover:underline">contact page</a> reaches us directly.
      </p>
    </article>
  );
}
