import type { MetadataRoute } from "next";

/**
 * Installability manifest — what makes WASP land on a home screen or dock as
 * an app of its own on iPhone, Android, Mac and Windows.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WASP — Team Chat & Workspaces",
    short_name: "WASP",
    description: "Real-time messaging with personal chats, team workspaces, and calls.",
    start_url: "/messages",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f7fb",
    theme_color: "#1d4ed8",
    categories: ["social", "communication"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
