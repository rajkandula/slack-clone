/* WASP service worker.
   No fetch handler on purpose: the app is realtime (SSE + WebSockets) and a
   cache layer in front of that is all risk, no reward. This worker makes the
   app installable and carries push notifications. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* not ours */ }
  const title = data.title || "WASP";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || "wasp",
      renotify: true,
      data: { url: data.url || "/messages" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/messages";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // Prefer focusing an existing WASP window over opening another.
      for (const win of windows) {
        if (new URL(win.url).origin === self.location.origin) {
          win.focus();
          return win.navigate ? win.navigate(url) : undefined;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
