import { CONTACT_EMAIL, contactNotificationEmail, sendMail } from "@/lib/mail";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

/**
 * POST /api/contact — the public contact form. No auth (visitors use it), but
 * edge rate limiting (worker) plus a honeypot field keep the inbox humane.
 */
export async function POST(request: Request) {
  try {
    const { name, email, message, company } = await request.json();

    // `company` is the honeypot — humans never see the field.
    if (typeof company === "string" && company.trim() !== "") {
      return NextResponse.json({ ok: true });
    }

    const cleanName = String(name || "").trim().slice(0, 100);
    const cleanEmail = String(email || "").trim().slice(0, 200);
    const cleanMessage = String(message || "").trim().slice(0, 4000);
    if (!cleanName || !cleanMessage || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return NextResponse.json({ error: "Please fill in your name, a valid email, and a message." }, { status: 400 });
    }

    const db = await getDb();
    await db.collection("contact_messages").insertOne({
      name: cleanName,
      email: cleanEmail,
      message: cleanMessage,
      handled: false,
      createdAt: new Date(),
    });

    // Also land it in the team inbox (CONTACT_EMAIL), so this reaches a
    // human without anyone having to open the admin dashboard. Never fatal:
    // the message is already saved.
    if (CONTACT_EMAIL) void (async () => {
      try {
        const tpl = contactNotificationEmail({
          name: cleanName,
          email: cleanEmail,
          message: cleanMessage,
        });
        await sendMail({ to: CONTACT_EMAIL, ...tpl });
      } catch (err) {
        console.error("[contact] notification email failed:", err);
      }
    })();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Contact form error:", err);
    return NextResponse.json({ error: "Something went wrong — please try again." }, { status: 500 });
  }
}
