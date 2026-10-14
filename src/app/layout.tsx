import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  metadataBase: new URL("https://heywasp.com"),
  title: "WASP — Team Chat & Workspaces",
  description:
    "WASP is a fast, real-time messaging app with personal chats and team workspaces, built with Next.js and MongoDB, running on Harakumo.",
  openGraph: {
    title: "WASP — Say hey to your team",
    description: "Personal chats, team workspaces and HD calls — in one fast app. Free on every device.",
    url: "https://heywasp.com",
    siteName: "WASP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "WASP — Say hey to your team",
    description: "Personal chats, team workspaces and HD calls — in one fast app. Free on every device.",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "WASP",
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1d4ed8",
  // Lets the app paint edge-to-edge behind the iPhone notch when installed.
  viewportFit: "cover" as const,
};

// Applied before first paint so the correct theme is already on <html>,
// preventing a light flash for dark-mode users.
const themeBootstrap = `(function(){try{
  var t = localStorage.getItem("wasp-theme");
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        {/* Registers the (cache-free) service worker that makes WASP installable. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})})}`,
          }}
        />
      </body>
    </html>
  );
}
