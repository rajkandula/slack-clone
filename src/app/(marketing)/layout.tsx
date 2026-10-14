import { MarketingHeader, MarketingFooter } from "@/components/marketing/MarketingChrome";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)]">
      <MarketingHeader />
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-6">{children}</main>
      <MarketingFooter />
    </div>
  );
}
