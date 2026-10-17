// Service worker: shows BBT's notifications and opens the page each one links to when it's tapped. No offline caching.
// An update to an activity someone is In for has Still in / I'm out buttons (DESIGN.md → v2, Notifications); browsers
// without notification buttons (iPhone) just show the notification, and tapping it opens the activity. A thread's
// messages share a tag, so a later one replaces the card; "quiet" ones do it without sound (DESIGN.md → Message
// notifications).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // not JSON: show a plain BBT notification
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "BBT", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/", activityId: data.activityId || null },
      actions: Array.isArray(data.actions) ? data.actions : [],
      ...(data.tag ? { tag: data.tag, renotify: !data.quiet, silent: Boolean(data.quiet) } : {}),
    }),
  );
});

// The push service replaced this device's subscription (browsers do this from time to time): register the new one, or
// notifications would stop while the switch still shows on. Signed out, it fails quietly and the switch shows off.
self.addEventListener("pushsubscriptionchange", (event) => {
  const key = event.oldSubscription?.options.applicationServerKey;
  const next = event.newSubscription
    ? Promise.resolve(event.newSubscription)
    : self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  event.waitUntil(
    next
      .then((sub) => {
        const { endpoint, keys } = sub.toJSON();
        return fetch("/api/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint, keys }),
          credentials: "same-origin",
        });
      })
      .catch(() => undefined),
  );
});

// A new version takes over at once (a Home Screen app may stay open for days), including pages opened before it, so a
// tapped notification can navigate them.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const openUrl = (path) => {
  let url = new URL(path || "/", self.location.origin);
  if (url.origin !== self.location.origin) url = new URL("/", self.location.origin); // only BBT's own pages
  url = url.href;
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
    const title = event.notification.title;
    event.waitUntil(
      fetch(`/api/activities/${encodeURIComponent(data.activityId)}/rsvp`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "out", routeLabel: null }),
        credentials: "same-origin",
        signal: AbortSignal.timeout(5000), // fall back while the tap still allows opening a window
      })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return self.registration.showNotification("You're out", {
            body: title,
            icon: "/icons/icon-192.png",
            badge: "/icons/icon-192.png",
            data: { url: data.url },
          });
        })
        .catch(() => openUrl(data.url)), // signed out, offline or no longer open: answer on the activity page
    );
    return;
  }
  event.waitUntil(openUrl(data.url));
});
