// Service worker: shows ride notifications and opens the ride when one is tapped. No offline caching.
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "BBT Ride", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});

// Take control of pages opened before this worker, so a tapped notification can navigate them.
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (wins) => {
      const open = wins.find((w) => w.url.startsWith(self.location.origin));
      if (!open) return self.clients.openWindow(url);
      await open.focus();
      return open.navigate(url).catch(() => self.clients.openWindow(url));
    }),
  );
});
