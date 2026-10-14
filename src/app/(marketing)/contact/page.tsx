import type { Metadata } from "next";
import ContactForm from "./contact-form";

export const metadata: Metadata = { title: "Contact — WASP" };

export default function Contact() {
  return (
    <article>
      <h1 className="text-3xl font-extrabold tracking-tight">Talk to us</h1>
      <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">
        Questions, feedback, a bug, a partnership, or an account request — send it here and
        it lands directly with the team. We read everything.
      </p>
      <ContactForm />
    </article>
  );
}
