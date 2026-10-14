import { notFound } from "next/navigation";
import ShellClient from "./shell-client";

/**
 * The app shell is a catch-all so client-side navigation owns the URL ("/"
 * itself is the marketing landing page, src/app/page.tsx). Unknown paths are
 * rejected server-side so bogus URLs get a real 404 status.
 */
const VIEWS = new Set(["messages", "home", "explore", "notifications", "profile", "settings"]);

export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const slug = (await params).slug;
  const [head] = slug;
  const known =
    (slug.length === 1 && VIEWS.has(head)) ||
    (slug.length === 2 && (head === "u" || head === "w"));
  if (!known) notFound();
  return <ShellClient />;
}
