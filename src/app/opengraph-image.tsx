import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";

/**
 * The social link-preview card (Open Graph image) for heywasp.com.
 * Rendered server-side to a 1200×630 PNG — X/Twitter, iMessage, Slack,
 * WhatsApp and LinkedIn all pick it up via the metadata route.
 */
export const alt = "WASP — Say hey to your team";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const Mark = ({ px }: { px: number }) => (
  <svg width={px} height={px} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="og-wasp-body" x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
        <stop stopColor="#4f8df9" />
        <stop offset="1" stopColor="#1d4ed8" />
      </linearGradient>
    </defs>
    <path
      d="M20.5 3.02a7 7 0 0 1 7 0l11.62 6.71a7 7 0 0 1 3.5 6.06v13.42a7 7 0 0 1-3.5 6.06L27.5 41.98a7 7 0 0 1-7 0L8.88 35.27a7 7 0 0 1-3.5-6.06V15.79a7 7 0 0 1 3.5-6.06L20.5 3.02Z"
      fill="url(#og-wasp-body)"
    />
    <g stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round">
      <path d="M15.5 17.5h17" transform="rotate(-8 24 17.5)" />
      <path d="M14 24.5h20" transform="rotate(-8 24 24.5)" />
      <path d="M17.5 31.5h13" transform="rotate(-8 24 31.5)" />
    </g>
  </svg>
);

export default async function OgImage() {
  // import.meta.url-relative assets are carried into the standalone build,
  // so the fonts resolve inside the production container too.
  const [inter, interBold] = await Promise.all([
    readFile(new URL("./og/inter-400.woff", import.meta.url)),
    readFile(new URL("./og/inter-800.woff", import.meta.url)),
  ]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          backgroundColor: "#0b0d10",
          backgroundImage:
            "radial-gradient(900px 500px at 85% -10%, rgba(37,99,235,0.28), rgba(11,13,16,0)), radial-gradient(700px 400px at -5% 110%, rgba(29,78,216,0.18), rgba(11,13,16,0))",
          fontFamily: "Inter",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <Mark px={84} />
          <div style={{ display: "flex", fontSize: 58, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.02em" }}>
            WASP
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              display: "flex",
              fontSize: 88,
              fontWeight: 800,
              color: "#ffffff",
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
            }}
          >
            <span>Say&nbsp;</span>
            <span style={{ color: "#3b82f6" }}>hey&nbsp;</span>
            <span>to your team.</span>
          </div>
          <div style={{ display: "flex", fontSize: 33, color: "#9ca3af", lineHeight: 1.4 }}>
            Personal chats, team workspaces and HD calls — in one fast app.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 14 }}>
            {["Chats", "Workspaces", "HD calls", "Waspmoji", "Free"].map((t) => (
              <div
                key={t}
                style={{
                  display: "flex",
                  padding: "10px 24px",
                  borderRadius: 100,
                  border: "1.5px solid rgba(37,99,235,0.45)",
                  backgroundColor: "rgba(37,99,235,0.14)",
                  color: "#bfdbfe",
                  fontSize: 24,
                  fontWeight: 600,
                }}
              >
                {t}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: "#e5e7eb" }}>heywasp.com</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Inter", data: inter, weight: 400, style: "normal" },
        { name: "Inter", data: interBold, weight: 800, style: "normal" },
      ],
    }
  );
}
