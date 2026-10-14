import Link from "next/link";
import WaspMark from "@/components/WaspMark";
import AuthNav from "./AuthNav";

/** Shared header + footer for the landing page and every marketing page. */
export function MarketingHeader() {
  return (
    // .marketing-chrome also unlocks document scrolling via body:has() —
    // the app shell locks body overflow, which broke every marketing page.
    <header className="marketing-chrome">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
        <Link href="/" className="flex cursor-pointer items-center gap-2.5">
          <WaspMark size={30} />
          <span className="text-lg font-bold tracking-tight text-[var(--text-primary)]">WASP</span>
        </Link>
        {/* Anchors resolve against the landing page from every marketing page */}
        <nav className="hidden items-center gap-7 text-sm font-medium text-[var(--text-secondary)] md:flex">
          <Link href="/#features" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">Features</Link>
          <Link href="/#how-it-works" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">How it works</Link>
          <Link href="/#install" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">Install</Link>
          <Link href="/contact" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">Contact</Link>
        </nav>
        <AuthNav variant="header" />
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--border-color)]">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="max-w-xs">
            <div className="flex items-center gap-2.5">
              <WaspMark size={26} />
              <span className="text-base font-bold text-[var(--text-primary)]">WASP</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
              One fast app for the way people actually talk — chats, workspaces,
              HD calls and a feed, on every device.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Product</h3>
            <ul className="mt-3 space-y-2.5 text-sm text-[var(--text-secondary)]">
              <li><Link href="/#features" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">Features</Link></li>
              <li><Link href="/#how-it-works" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">How it works</Link></li>
              <li><Link href="/#install" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">Install the app</Link></li>
              <li><AuthNav variant="footer" /></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Company</h3>
            <ul className="mt-3 space-y-2.5 text-sm text-[var(--text-secondary)]">
              <li><Link href="/#why-wasp" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">Why WASP</Link></li>
              <li><Link href="/contact" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">Contact us</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Legal</h3>
            <ul className="mt-3 space-y-2.5 text-sm text-[var(--text-secondary)]">
              <li><Link href="/privacy" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">Privacy Policy</Link></li>
              <li><Link href="/terms" className="cursor-pointer transition-colors duration-200 hover:text-[var(--text-primary)]">Terms of Service</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-[var(--border-color)] pt-6 text-sm text-[var(--text-muted)] sm:flex-row">
          <span>© 2026 WASP · heywasp.com</span>
          <span>Made for the way people actually talk.</span>
        </div>
      </div>
    </footer>
  );
}
