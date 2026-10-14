// End-to-end API check against the LOCAL dev server (npm run dev, with local D1 migrated).
// Run: node scripts/smoke.ts  — it creates test users and activities in the local database only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { addDays } from "../shared/time.ts";

const BASE = "http://localhost:8787";
const stamp = Date.now().toString(36);
// Sign-in is rate-limited per client IP; locally the IP comes from this header (Cloudflare sets it in production).
const ip = `10.${Date.now() % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
let failures = 0;

// biome-ignore lint/suspicious/noExplicitAny: responses are checked field by field below
type Json = any;

function check(cond: unknown, what: string) {
  console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
  if (!cond) failures++;
}

/** A client with its own cookie jar (cookies kept by name, as a browser does). */
function client() {
  const jar = new Map<string, string>();
  return async (path: string, init: { method?: string; body?: unknown; origin?: string | null } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": ip };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (init.origin !== null) headers.origin = init.origin ?? BASE;
    const res = await fetch(BASE + path, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair = "", ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      if (/max-age=0\b/i.test(attrs.join(";")) || pair.slice(i + 1) === "") jar.delete(name);
      else jar.set(name, pair.slice(i + 1));
    }
    const text = await res.text();
    let json: Json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  };
}

function sql(command: string) {
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", command], { stdio: "pipe" });
}
const tokenFromUrl = (url: string) => url.split("/").pop() as string;

// Only the seeded spots have sample forecasts; archive test spots an aborted run left in the pick list.
sql("update spots set archived = 1 where id not in ('suny-purchase', 'armonk', 'reeves')");

// Seed an Admin invite directly (in production the first Admin signs in with Google as BOOTSTRAP_ADMIN_EMAIL).
const adminToken = `smoke-admin-${stamp}`;
const adminEmail = `admin-${stamp}@example.test`;
const hash = createHash("sha256").update(adminToken).digest("hex");
const exp = new Date(Date.now() + 3600e3).toISOString();
sql(
  `insert into links (token_hash, kind, email, role, created_at, expires_at) values ('${hash}', 'invite', '${adminEmail}', 'admin', '${new Date().toISOString()}', '${exp}')`,
);

const admin = client();
const rider = client();
const anon = client();
const login = (c: ReturnType<typeof client>, email: string, password: string) =>
  c("/api/auth/sign-in/email", { body: { email, password } });

check(
  (await anon("/api/links", { body: { token: adminToken } })).json?.kind === "invite",
  "invite link readable without a session",
);
const weak = await anon("/api/links/accept", { body: { token: adminToken, name: "Admin", password: "short" } });
check(weak.status === 400, "short password refused");
const made = await anon("/api/links/accept", {
  body: { token: adminToken, name: "Admin", username: `admin${stamp}`, password: "correct horse battery" },
});
check(made.status === 204, `admin account created from invite (${made.status})`);
check((await login(admin, adminEmail, "correct horse battery")).status === 200, "new account signs in");
const me = (await admin("/api/me")).json;
check(me?.role === "admin" && me.methods?.includes("password"), "admin signed in with Admin role and password method");
check((await anon("/api/links", { body: { token: adminToken } })).status === 404, "invite link is single-use");

const riderEmail = `rider-${stamp}@example.test`;
const inv = await admin("/api/users/invites", { body: { email: riderEmail, role: "view" } });
check(inv.status === 201 && inv.json?.url?.includes("/invite/"), "admin creates an invite link");
check(
  (
    await anon("/api/links/accept", {
      body: { token: tokenFromUrl(inv.json.url), name: `Rider ${stamp}`, password: "pedal pedal pedal" },
    })
  ).status === 204 && (await login(rider, riderEmail, "pedal pedal pedal")).status === 200,
  "rider joins",
);
check((await rider("/api/me")).json?.role === "view", "rider has View role");
await rider("/api/activities"); // the rider's markers start here: anything posted later is new to them
check((await rider("/api/users")).status === 403, "rider can't list users");
check((await anon("/api/me")).status === 401, "no session → 401");
check(
  (await admin("/api/settings", { method: "PUT", body: { pace: 18 }, origin: null })).status === 403,
  "write without Origin refused",
);

const pw = client();
const signIn = await pw("/api/auth/sign-in/username", {
  body: { username: `admin${stamp}`, password: "correct horse battery" },
});
check(
  signIn.status === 200,
  `sign in with username + password (${signIn.status} ${signIn.status === 200 ? "" : JSON.stringify(signIn.json)})`,
);

// Weather and routes (served from the local cache after scripts/dev-seed.ts; this container can't reach the APIs)
const wx = (await rider("/api/weather")).json;
check(wx?.forecast?.["suny-purchase"]?.hourly?.time?.length > 24, "weather: forecast for each spot");
check(
  (await rider("/api/routes/57406828")).json?.pois?.some((p: Json) => p.name === "Tazza Cafe"),
  "route with its coffee stop",
);
check(
  (await admin("/api/routes?q=katonah")).json?.some((r: Json) => r.id === 57406828),
  "route library search",
);
check((await rider("/api/routes?q=katonah")).status === 403, "route search is for editors");
check((await rider("/api/routes/99999999")).status === 404, "riders can't look up routes the app hasn't seen");
check((await admin("/api/auth/admin/list-users")).status === 404, "Better Auth's admin endpoints are unreachable");

// Review fixes: names, push endpoints
check(
  (await rider("/api/auth/update-user", { body: { name: "x".repeat(200) } })).status === 400,
  "names over 80 characters refused",
);
check(
  (await rider("/api/auth/update-user", { body: { name: "Ride update" } })).status === 400,
  "system labels refused as names",
);
const evilPush = await rider("/api/push", {
  body: { endpoint: "https://evil.example/collect", keys: { p256dh: "x", auth: "y" } },
});
check(evilPush.status === 400, "push endpoints must be a browser push service");
check(
  (await rider("/api/push", { body: { endpoint: "not a url", keys: { p256dh: "x", auth: "y" } } })).status === 400,
  "a malformed push endpoint is a 400, not a server error",
);
// The Android app's Firebase token
const fcmToken = `smoke-${stamp}:APA91b${"x".repeat(40)}`;
check((await rider("/api/push/app", { body: { token: fcmToken } })).status === 204, "the app registers its token");
check((await rider("/api/push/app", { body: { token: fcmToken } })).status === 204, "registering again is fine");
check(
  (await rider("/api/push/app", { body: { token: "no spaces allowed here at all" } })).status === 400,
  "a malformed app token is refused",
);
check(
  (await rider("/api/push", { method: "DELETE", body: { endpoint: fcmToken } })).status === 204,
  "the app's token can be removed",
);

// Settings
const defaults = (await admin("/api/settings")).json.settings;
check(
  defaults?.warn?.run?.feelCaution != null && defaults.sports.includes("pickleball"),
  "settings have sports and weather groups",
);
check((await admin("/api/settings", { method: "PUT", body: { pace: 99 } })).status === 400, "invalid setting refused");
check(
  (
    await admin("/api/settings", {
      method: "PUT",
      body: { warn: { ...defaults.warn, run: { ...defaults.warn.run, feelNoGo: 45 } } },
    })
  ).status === 400,
  "a red threshold milder than amber is refused",
);
check(
  (await admin("/api/settings", { method: "PUT", body: { sports: ["ride", "kayak"] } })).status === 400,
  "an unknown sport is refused",
);
const oneGroup = await admin("/api/settings", {
  method: "PUT",
  body: { warn: { run: { ...defaults.warn.run, feelCaution: 31 } } },
});
check(
  oneGroup.json?.settings?.warn?.run?.feelCaution === 31 &&
    oneGroup.json.settings.warn.ride.feelCaution === defaults.warn.ride.feelCaution,
  "saving one weather group leaves the others alone",
);
check(
  (await admin("/api/settings/kit", { method: "PUT", body: [{ minFeel: 50, name: "One", items: ["Jersey"] }] }))
    .status === 400,
  "the kit chart needs seven bands",
);
check(
  (await admin("/api/settings", { method: "PUT", body: { pace: 18 } })).json?.settings?.pace === 18,
  "admin changes a setting",
);
check(
  (await rider("/api/settings", { method: "PUT", body: { pace: 16 } })).status === 403,
  "rider can't change settings",
);
await admin("/api/settings/reset", { method: "POST" });

// Spots
const spot = await admin("/api/spots", {
  body: { name: `Test spot ${stamp}`, link: "javascript:alert(1)//@41.1,-73.7", note: "Lot B" },
});
check(
  spot.status === 201 && spot.json.maps_url.startsWith("https://www.google.com/maps/search/"),
  "unsafe link replaced by a coordinates link",
);
// This sandbox can't reach Open-Meteo, so the new spot has no forecast; the seeded spots must still come back.
const partial = await admin("/api/weather");
check(
  partial.status === 200 && partial.json.forecast.armonk && !partial.json.forecast[spot.json.id],
  "a spot without a forecast doesn't blank the others",
);
const fakeMaps = await admin("/api/spots", {
  body: { name: `Fake maps ${stamp}`, link: "https://google.evil.com/@41.2,-73.7", note: "Lot" },
});
check(
  fakeMaps.json?.maps_url?.startsWith("https://www.google.com/maps/search/"),
  "look-alike Maps domain replaced by a coordinates link",
);
await admin(`/api/spots/${fakeMaps.json.id}`, { method: "PATCH", body: { archived: true } });
check(
  (await admin("/api/spots", { body: { name: `test SPOT ${stamp}`, link: "41.1, -73.7", note: "Lot" } })).status ===
    409,
  "duplicate spot name refused",
);
const noNotes = await admin("/api/spots", { body: { name: `No notes ${stamp}`, link: "41.1, -73.7", note: " " } });
await admin(`/api/spots/${noNotes.json?.id}`, { method: "PATCH", body: { archived: true } }); // keep the pick list short
check(noNotes.status === 201 && noNotes.json.note === "", "notes are optional (pools and courts may need none)");
check(
  (await admin("/api/spots", { body: { name: `No pin ${stamp}`, link: "https://example.com", note: "Lot" } }))
    .status === 400,
  "a link without a pin is refused",
);
const moved = await admin(`/api/spots/${spot.json.id}`, {
  method: "PATCH",
  body: { link: "https://www.google.com/maps/place/X/@41.3,-73.8,17z/data=!3d41.31!4d-73.81" },
});
check(
  moved.json?.lat === 41.31 && moved.json?.maps_url?.startsWith("https://www.google.com/maps/place/"),
  "editing the Maps link moves the pin and keeps the link",
);
check(
  (await rider("/api/spots", { body: { name: "Nope", link: "41.1, -73.7", note: "Lot" } })).status === 403,
  "rider can't add spots",
);
check(
  (await rider(`/api/spots/${spot.json.id}`, { method: "PATCH", body: { archived: true } })).status === 403,
  "only admins archive spots",
);
const archived = await admin(`/api/spots/${spot.json.id}`, { method: "PATCH", body: { archived: true } });
check(
  archived.json?.archived === true,
  `admin archives the test spot (${archived.status} ${archived.json?.archived === true ? "" : JSON.stringify(archived.json).slice(0, 200)})`,
);

// Activities: a ride on a future date no earlier run used
const day = new Date(Date.now() + (400 + (Math.floor(Date.now() / 1000) % 90000)) * 864e5).toISOString().slice(0, 10); // unique per second
const plan = {
  sport: "ride",
  date: day,
  startTime: "08:30",
  spotId: "suny-purchase",
  pace: 17,
  notes: "Lights on",
  routes: [
    { label: "Full", routeId: 57406828, stop: "Tazza Cafe" },
    { label: "Short", routeId: 57426135, stop: null },
  ],
};
check((await rider("/api/activities", { body: plan })).status === 403, "rider can't publish");
check(
  (await admin("/api/activities", { body: { ...plan, date: "2027-02-31" } })).status === 400,
  "an impossible date is refused",
);
const pub = await admin("/api/activities", { body: plan });
check(
  pub.status === 201 && pub.json.status === "published",
  `admin publishes a ride (${pub.status} ${pub.status === 201 ? "" : JSON.stringify(pub.json)})`,
);
const id = pub.json.id;
// New and unread markers (DESIGN.md → New and unread)
const unseen = async () => ((await rider("/api/activities")).json as Json[]).find((a) => a.id === id)?.unseen;
{
  const u = await unseen();
  check(u?.isNew === true && u.by === "Admin", `a ride posted by someone else shows as New (${JSON.stringify(u)})`);
  check(
    ((await admin("/api/activities")).json as Json[]).find((a) => a.id === id)?.unseen === null,
    "your own post isn't new to you",
  );
  check((await rider(`/api/activities/${id}`)).json.seenBefore === null, "opening it says it was new to you");
  check((await unseen()) === null, "…and clears its marker");
}
{
  // Several activities of a sport may share a day; the second one doesn't touch the first.
  const second = await admin("/api/activities", { body: { ...plan, title: `B group ${stamp}` } });
  check(
    second.status === 201 && (await admin(`/api/activities/${id}`)).json.status === "published",
    `a second ride on the same date is posted alongside the first (${second.status})`,
  );
  await admin(`/api/activities/${second.json.id}/cancel`, { method: "POST" });
}
const pickle = {
  sport: "pickleball",
  title: `Doubles ${stamp}`,
  date: day,
  startTime: "18:30",
  endTime: "20:30",
  spotId: "suny-purchase",
  outdoor: false,
  details: "2 courts",
  notes: "",
};
await admin("/api/settings", { method: "PUT", body: { sports: ["ride", "run"] } });
check((await admin("/api/activities", { body: pickle })).status === 400, "a sport that's turned off is refused");
await admin("/api/settings", { method: "PUT", body: { sports: defaults.sports } });
const pk = await admin("/api/activities", { body: pickle });
check(
  pk.status === 201 && pk.json.sport === "pickleball" && pk.json.outdoor === false && pk.json.pace === 0,
  `another sport can share the day (${pk.status} ${pk.status === 201 ? "" : JSON.stringify(pk.json)})`,
);
const tri = await admin("/api/activities", {
  body: { ...pickle, sport: "triathlon", outdoor: true, startTime: "07:00", endTime: "10:00", details: "Sprint" },
});
check(
  tri.status === 201 && tri.json.sport === "triathlon" && tri.json.icon === null,
  `a triathlon can be planned (${tri.status})`,
);
const kayak = await admin("/api/activities", { body: { ...pickle, sport: "other", icon: "kayaking", details: "" } });
check(kayak.status === 201 && kayak.json.icon === "kayaking", "an Other activity keeps the icon an editor picked");
check(
  (await admin("/api/activities", { body: { ...pickle, sport: "other", icon: "rocket", date: addDays(day, 1) } }))
    .status === 400,
  "an icon that isn't on the list is refused",
);
check(
  (await admin("/api/activities", { body: { ...pickle, endTime: "18:00", date: addDays(day, 1) } })).status === 400,
  "an end time before the start is refused",
);
check(
  (await admin("/api/activities", { body: { ...pickle, routes: plan.routes, date: addDays(day, 1) } })).status === 400,
  "only rides and runs take routes",
);
check(
  (await admin("/api/activities", { body: { ...plan, routes: [], date: addDays(day, 1) } })).status === 400,
  "a ride needs a route",
);
const runPlan = {
  ...plan,
  sport: "run",
  pace: 6.5,
  routes: [{ label: "Main", routeId: 57426135, stop: "Tazza Cafe" }],
};
const run = await admin("/api/activities", { body: runPlan });
check(run.status === 201 && run.json.sport === "run" && run.json.outdoor === true, "a run is published");
check(
  (
    await admin(`/api/activities/${pk.json.id}`, {
      method: "PUT",
      body: { ...pickle, sport: "swim", baseUpdatedAt: pk.json.updatedAt },
    })
  ).status === 400,
  "the sport can't change on an update",
);

let d = (await rider(`/api/activities/${id}/rsvp`, { method: "PUT", body: { status: "in", routeLabel: "Short" } }))
  .json;
check(
  d.rsvps.some((r: Json) => r.name === `Rider ${stamp}` && r.routeLabel === "Short"),
  "rider RSVPs In on the Short route",
);
{
  const list = (await rider("/api/activities")).json as Json[];
  check(
    list.find((a) => a.id === id)?.mine === "in" && list.every((a) => a.id === id || a.mine !== "in"),
    "the upcoming list carries the viewer's own answer",
  );
}

// Calendar link (DESIGN.md → v2): private feed of what you're In for, readable without a session, revoked by Reset.
const feed = async (url: string) => {
  const res = await fetch(BASE + new URL(url).pathname);
  return { status: res.status, type: res.headers.get("content-type") ?? "", text: await res.text() };
};
check((await rider("/api/me")).json?.calendarUrl === null, "no calendar link until asked for");
const cal1 = (await rider("/api/me/calendar", { method: "POST" })).json?.calendarUrl as string;
check(/\/api\/cal\/[^/]+\.ics$/.test(cal1 ?? ""), "calendar link made");
let f = await feed(cal1);
check(
  f.status === 200 && f.type.startsWith("text/calendar") && f.text.includes(`UID:${id}@app.bbt.team`),
  "calendar feed has the activity the rider is In for",
);
check(
  !(await feed((await admin("/api/me/calendar", { method: "POST" })).json.calendarUrl)).text.includes(`UID:${id}@`),
  "another person's feed doesn't",
);
check(
  (await feed(cal1.replace(/\.([A-Za-z0-9_-]+)\.ics$/, ".AAAA$1.ics"))).status === 404,
  "a forged calendar link is refused",
);
check(
  (await rider("/api/me/calendar", { method: "POST" })).json?.calendarUrl === cal1,
  "asking again gives the same link",
);
const cal2 = (await rider("/api/me/calendar/reset", { method: "POST" })).json?.calendarUrl as string;
check(
  cal2 !== cal1 && (await feed(cal1)).status === 404 && (await feed(cal2)).status === 200,
  "Reset stops the old calendar link",
);
await rider("/api/me/muted/swim", { method: "PUT", body: { off: true } });
await rider("/api/me/muted/other", { method: "PUT", body: { off: true } });
await rider("/api/me/muted/other", { method: "PUT", body: { off: true } });
check((await rider("/api/me")).json?.mutedSports?.toSorted().join() === "other,swim", "muted sports saved");
check(
  (await rider("/api/me/muted/golf", { method: "PUT", body: { off: true } })).status === 400,
  "only known sports can be muted",
);
await rider("/api/me/muted/swim", { method: "PUT", body: { off: false } });
check(
  (await rider("/api/me/muted/other", { method: "PUT", body: { off: false } })).json?.mutedSports?.length === 0,
  "muted sports turned back on",
);
d = (await rider(`/api/activities/${id}/messages`, { body: { body: "Anyone driving from White Plains?" } })).json;
const msgId = d.messages.at(-1).id;
d = (await admin(`/api/activities/${id}/messages`, { body: { body: "I can take one", parentId: msgId } })).json;
check(d.messages.length === 2 && d.messages[1].parentId === msgId, "admin replies to the rider's message");
check(
  (await rider(`/api/activities/${id}/messages`, { body: { body: "nested", parentId: d.messages[1].id } })).status ===
    400,
  "replies are one level deep",
);
check(
  (await admin(`/api/messages/${msgId}`, { method: "PATCH", body: { body: "edited" } })).status === 403,
  "only the author edits a message",
);
{
  const u = await unseen();
  check(
    u?.messages === 1 && u.from.join() === "Admin" && !u.isNew,
    `other people's new messages are counted, your own aren't (${JSON.stringify(u)})`,
  );
  const seen = (await rider(`/api/activities/${id}`)).json.seenBefore;
  check(typeof seen === "string" && (await unseen()) === null, "opening it again clears the count");
}

const base = pub.json.updatedAt;
const upd = await admin(`/api/activities/${id}`, {
  method: "PUT",
  body: { ...plan, startTime: "09:00", baseUpdatedAt: base },
});
check(upd.json?.lastUpdate?.text?.includes("meet 8:30 AM → 9:00 AM"), "update posts what changed");
check(upd.json.rsvps.length === 1, "RSVPs kept after an update");
check(
  (await unseen())?.change === "Changed: meet 8:30 AM → 9:00 AM",
  "a change by someone else is marked with what changed",
);
await rider(`/api/activities/${id}`);
{
  const h = upd.json.history as Json[];
  check(
    h?.length === 2 &&
      h[0].action === "changed" &&
      h[0].text?.includes("meet 8:30 AM → 9:00 AM") &&
      h[1].action === "created" &&
      h[0].who &&
      h[1].who === h[0].who,
    `History: created, then changed with what changed (${JSON.stringify(h?.map((x) => x.action))})`,
  );
}
check(
  (await admin(`/api/activities/${id}`, { method: "PUT", body: { ...plan, notes: "stale", baseUpdatedAt: base } }))
    .status === 409,
  "an update based on an older version is refused",
);
check(
  (await admin(`/api/activities/${id}`, { method: "PUT", body: { ...plan, notes: "no base" } })).status === 400,
  "an update must say which version it edits",
);
let c = (await admin(`/api/activities/${id}/cancel`, { method: "POST" })).json;
check(
  c.status === "cancelled" && c.messages.some((m: Json) => m.kind === "cancel"),
  "cancel keeps the ride and posts a message",
);
c = (
  await admin(`/api/activities/${id}`, {
    method: "PUT",
    body: { ...plan, startTime: "09:00", notes: "still cancelled?", baseUpdatedAt: c.updatedAt },
  })
).json;
check(c.status === "cancelled", "editing a cancelled ride keeps it cancelled");
check(c.lastUpdate?.text === upd.json.lastUpdate?.text, "editing a cancelled ride posts no update");
f = await feed(cal2);
check(f.text.includes("STATUS:CANCELLED") && f.text.includes("Cancelled: BBT"), "calendar feed shows the cancellation");
check(
  (await rider(`/api/activities/${id}/rsvp`, { method: "PUT", body: { status: "out", routeLabel: null } })).status ===
    409,
  "no RSVP on a cancelled ride",
);
check(
  (await rider(`/api/activities/${id}/messages`, { body: { body: "Still on?", parentId: null } })).status === 409,
  "no posting on a cancelled ride",
);
c = (await admin(`/api/activities/${id}/restore`, { method: "POST" })).json;
check(c.status === "published", "restore");
check(
  (await admin("/api/activities", { body: { ...plan, notes: "new plan", replaceId: pk.json.id } })).status === 409,
  "Replace only names a same-sport activity that day",
);
const rep = await admin("/api/activities", { body: { ...plan, notes: "new plan", replaceId: id } });
check(rep.status === 201, "replace publishes the new ride");
check(
  (await admin(`/api/activities/${id}`)).json.status === "cancelled",
  "…and cancels the old one, which keeps its history",
);
check(
  (await rider("/api/activities")).json.some((r: Json) => r.id === rep.json.id),
  "upcoming list includes the new ride",
);
check(!(await rider("/api/activities")).json.some((r: Json) => r.id === id), "…and leaves out the one it replaced");
check(
  (await admin(`/api/activities/${pk.json.id}`)).json.status === "published",
  "replacing the ride leaves the pickleball session alone",
);

// Users
const list = (await admin("/api/users")).json;
const riderRow = list.users.find((u: Json) => u.name === `Rider ${stamp}`);
check(riderRow?.methods?.includes("password") && riderRow.role === "view", "users list shows role and sign-in methods");
await admin(`/api/users/${riderRow.id}`, { method: "PATCH", body: { role: "edit" } });
check((await rider("/api/me")).json?.role === "edit", "role change applies on the next request");
check(
  (await admin(`/api/users/${me.id}`, { method: "PATCH", body: { role: "view" } })).status === 400,
  "admin can't demote themselves",
);
const reset = await admin(`/api/users/${riderRow.id}/reset-link`, { method: "POST" });
const rider2 = client();
check(
  (
    await anon("/api/links/accept", {
      body: { token: tokenFromUrl(reset.json.url), password: "new pedal pedal pedal" },
    })
  ).status === 204 && (await login(rider2, riderEmail, "new pedal pedal pedal")).status === 200,
  "reset link sets a new password",
);
check((await rider("/api/me")).status === 401, "reset signs the rider out elsewhere");
await admin(`/api/users/${riderRow.id}`, { method: "PATCH", body: { disabled: true } });
await admin(`/api/users/${riderRow.id}`, { method: "PATCH", body: { disabled: false } });
check((await feed(cal2)).status === 404, "disabling ends the calendar link, even after re-enabling");
await admin(`/api/users/${riderRow.id}`, { method: "PATCH", body: { disabled: true } });
check((await rider2("/api/me")).status === 401, "disabling ends the rider's sessions");

// Rate limit on password sign-in
const brute = client();
const codes: number[] = [];
for (let i = 0; i < 7; i++)
  codes.push(
    (await brute("/api/auth/sign-in/email", { body: { email: adminEmail, password: `wrong-${i}-xxxxxx` } })).status,
  );
check(codes.includes(429), `sign-in attempts are rate-limited (${codes.join(",")})`);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
