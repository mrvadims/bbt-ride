// Service worker: shows activity notifications and opens the activity when one is tapped. No offline caching.
// An update to an activity someone is In for has Still in / I'm out buttons (DESIGN.md → v2, Notifications); browsers
// without notification buttons (iPhone) just show the notification, and tapping it opens the activity.
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "BBT", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/", activityId: data.activityId || null },
      actions: Array.isArray(data.actions) ? data.actions : [],
    }),
  );
});

// Take control of pages opened before this worker, so a tapped notification can navigate them.
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const openUrl = (path) => {
  const url = new URL(path || "/", self.location.origin).href;
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (wins) => {
    const open = wins.find((w) => w.url.startsWith(self.location.origin));
    if (!open) return self.clients.openWindow(url);
    await open.focus();
    return open.navigate(url).catch(() => self.clients.openWindow(url));
  });
};

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if (event.action === "in") return; // already In: nothing to change
  if (event.action === "out" && data.activityId) {
    event.waitUntil(
      fetch(`/api/activities/${encodeURIComponent(data.activityId)}/rsvp`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "out", routeLabel: null }),
        credentials: "same-origin",
      })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
        })
        .catch(() => openUrl(data.url)), // signed out or offline: open the activity so they can answer there
    );
    return;
  }
  event.waitUntil(openUrl(data.url));
});
