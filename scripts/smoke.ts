// End-to-end API check against the LOCAL dev server (npm run dev, with local D1 migrated).
// Run: node scripts/smoke.ts  — it creates test users and activities in the local database only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { addDays, nyNow } from "../shared/time.ts";

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

/** A client with its own cookie jar (cookies kept by name, as a browser does), from `from` (sign-in is rate-limited per
 * address). */
function client(from = ip) {
  const jar = new Map<string, string>();
  return async (path: string, init: { method?: string; body?: unknown; origin?: string | null } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": from };
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
check(
  (await anon("/api/links/accept", { body: { token: adminToken, name: "Admin", password: "correct horse battery" } }))
    .status === 400,
  "an invite needs a phone number",
);
const made = await anon("/api/links/accept", {
  body: {
    token: adminToken,
    name: "Admin",
    username: `admin${stamp}`,
    password: "correct horse battery",
    contact: { phone: "(914) 555-0142", emergencyName: "Chris Admin", emergencyPhone: "914 555 0190" },
  },
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
      body: {
        token: tokenFromUrl(inv.json.url),
        name: `Rider ${stamp}`,
        password: "pedal pedal pedal",
        contact: { phone: "203-555-0119" },
      },
    })
  ).status === 204 && (await login(rider, riderEmail, "pedal pedal pedal")).status === 200,
  "rider joins",
);
check((await rider("/api/me")).json?.role === "view", "rider has View role");

// Team and contacts
check(
  me?.phone === "+19145550142" && me.emergencyName === "Chris Admin" && me.emergencyPhone === "+19145550190",
  "invite saves the phone and emergency contact",
);
check(
  (await rider("/api/me/contact", { method: "PUT", body: { phone: "555" } })).status === 400,
  "a phone number that isn't one is refused",
);
check(
  (await rider("/api/me/contact", { method: "PUT", body: { phone: "2035550119", emergencyName: "Pat" } })).status ===
    400,
  "an emergency contact needs a name and a phone",
);
const riderMe = (
  await rider("/api/me/contact", {
    method: "PUT",
    body: { phone: "2035550119", emergencyName: "Pat Rider", emergencyPhone: "(203) 555-0177" },
  })
).json;
check(riderMe?.emergencyPhone === "+12035550177", "anyone updates their own contact info");
{
  const t = (await rider("/api/team")).json as Json[];
  const a = t?.find((m) => m.id === me.id);
  check(
    a?.phone === "+19145550142" && a.emergencyName === "Chris Admin" && !("role" in a),
    "everyone sees the team directory, emergency contacts included, but not other people's roles",
  );
  const asAdmin = ((await admin("/api/team")).json as Json[]).find((m) => m.id === me.id);
  check(asAdmin?.role === "admin", "Admins see roles in the directory");
}
await rider("/api/activities"); // the rider's markers start here: anything posted later is new to them
check((await rider("/api/users")).status === 403, "rider can't list users");
check((await anon("/api/me")).status === 401, "no session → 401");
check(
  (await fetch(`${BASE.replace("localhost", "127.0.0.1")}/api/health`)).status === 403,
  "plain HTTP is refused (anywhere but local development)",
);
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
  (await rider("/api/auth/update-user", { body: { name: "Former member" } })).status === 400,
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
  (await admin("/api/spots", { body: { name: `No pin ${stamp}`, link: "the lot by the lake", note: "Lot" } }))
    .status === 400,
  "text that's neither a pin nor a link is refused",
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
  await rider(`/api/activities/${id}`);
  check((await unseen())?.isNew === true, "just reading it (Plan, refreshes) doesn't count as opening it");
  check(
    ((await admin("/api/activities")).json as Json[]).find((a) => a.id === id)?.unseen === null,
    "your own post isn't new to you",
  );
  check(
    (await rider(`/api/activities/${id}/seen`, { body: {} })).json.seenBefore === null,
    "opening it says it was new to you",
  );
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
  const r = await rider(`/api/activities/${id}/messages`, { body: { body: `Pump? <@${me.id}>`, parentId: null } });
  check(
    r.status === 201 && r.json.messages.some((m: Json) => m.body === `Pump? <@${me.id}>`),
    "a mention is stored as a token that follows the person",
  );
  const mid = r.json.messages.find((m: Json) => m.body === `Pump? <@${me.id}>`).id;
  const many = Array.from({ length: 11 }, (_, i) => `<@u${i}>`).join(" ");
  check(
    (await rider(`/api/activities/${id}/messages`, { body: { body: many, parentId: null } })).status === 400,
    "at most 10 people mentioned in one message",
  );
  await rider(`/api/messages/${mid}`, { method: "DELETE" });
}
{
  const u = await unseen();
  check(
    u?.messages === 1 && u.from.join() === "Admin" && !u.isNew,
    `other people's new messages are counted, your own aren't (${JSON.stringify(u)})`,
  );
  const seen = (await rider(`/api/activities/${id}/seen`, { body: {} })).json.seenBefore;
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
await rider(`/api/activities/${id}/seen`, { body: {} });
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

// Deleting an activity: Admins only, for good
{
  const d = await admin("/api/activities", { body: { ...plan, notes: "to delete" } });
  await rider(`/api/activities/${d.json.id}/rsvp`, { method: "PUT", body: { status: "in", routeLabel: null } });
  await rider(`/api/activities/${d.json.id}/messages`, { body: { body: "see you", parentId: null } });
  check((await rider(`/api/activities/${d.json.id}`, { method: "DELETE" })).status === 403, "only Admins delete");
  check((await admin(`/api/activities/${d.json.id}`, { method: "DELETE" })).status === 204, "an Admin deletes");
  check((await rider(`/api/activities/${d.json.id}`)).status === 404, "…and it's gone, with its RSVPs and messages");
  check(!(await rider("/api/activities")).json.some((r: Json) => r.id === d.json.id), "…and off the list");
}

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

// Private activities (DESIGN.md → Private activities): every route, for people invited and not, by role.
let people = 0;
/** A new signed-in member with this role, from an address of their own. */
async function member(role: "view" | "edit") {
  const n = ++people;
  const email = `p${n}-${stamp}@example.test`;
  const link = (await admin("/api/users/invites", { body: { email, role } })).json.url;
  await anon("/api/links/accept", {
    body: {
      token: tokenFromUrl(link),
      name: `Person${n} ${stamp}`,
      password: "private private",
      contact: { phone: "914-555-0100" },
    },
  });
  const c = client(`10.200.${n}.${Math.floor(Math.random() * 250)}`);
  await login(c, email, "private private");
  return { c, id: (await c("/api/me")).json.id as string };
}
const creator = await member("edit");
const coEditor = await member("edit"); // invited
const outEditor = await member("edit"); // not invited
const guest = await member("view"); // invited
const outsider = await member("view"); // not invited
const adminId = me.id as string; // not invited (at first)
const privDay = addDays(day, 3);
const privBody = { ...pickle, title: `Secret ${stamp}`, date: privDay, guests: [coEditor.id, guest.id] };
check(
  (await guest.c("/api/activities", { body: privBody })).status === 403,
  "private: a Member can't post (Editors only)",
);
check(
  (await creator.c("/api/activities", { body: { ...privBody, guests: [] } })).status === 400 &&
    (await creator.c("/api/activities", { body: { ...privBody, guests: [creator.id] } })).status === 400,
  "private: needs someone invited besides the creator",
);
check(
  (await creator.c("/api/activities", { body: { ...privBody, guests: ["no-such-user"] } })).status === 400 &&
    (await creator.c("/api/activities", { body: { ...privBody, guests: [riderRow.id] } })).status === 400,
  "private: can't invite an unknown or disabled account",
);
const priv = await creator.c("/api/activities", { body: privBody });
const pid = priv.json?.id as string;
check(
  priv.status === 201 &&
    priv.json.private === true &&
    priv.json.createdBy === creator.id &&
    priv.json.guests
      .map((g: Json) => g.userId)
      .sort()
      .join() === [creator.id, coEditor.id, guest.id].sort().join(),
  "private: posted, with the creator added to the guest list",
);
const note = await guest.c(`/api/activities/${pid}/messages`, { body: { body: "Bringing balls" } });
const mid = note.json?.messages?.find((m: Json) => m.body === "Bringing balls")?.id as string;
check(note.status === 201 && Boolean(mid), "private: a guest can post a message");
check(
  (await guest.c(`/api/activities/${pid}/rsvp`, { method: "PUT", body: { status: "in", routeLabel: null } })).status ===
    200,
  "private: a guest can answer In",
);
// Everyone not invited, Admin included, gets the same 404 as for an activity that doesn't exist, on every route.
const outs = [
  { who: "Admin", c: admin },
  { who: "Editor", c: outEditor.c },
  { who: "Member", c: outsider.c },
];
for (const { who, c } of outs) {
  const upd = { ...privBody, guests: undefined, baseUpdatedAt: priv.json.updatedAt };
  const codes = [
    (await c(`/api/activities/${pid}`)).status,
    (await c(`/api/activities/${pid}/seen`, { method: "POST" })).status,
    (await c(`/api/activities/${pid}/rsvp`, { method: "PUT", body: { status: "in", routeLabel: null } })).status,
    (await c(`/api/activities/${pid}/messages`, { body: { body: "hi" } })).status,
    (await c(`/api/messages/${mid}`, { method: "PATCH", body: { body: "edited" } })).status,
    (await c(`/api/messages/${mid}`, { method: "DELETE" })).status,
  ];
  const editor = who !== "Member";
  if (editor)
    codes.push(
      (await c(`/api/activities/${pid}`, { method: "PUT", body: upd })).status,
      (await c(`/api/activities/${pid}/cancel`, { method: "POST" })).status,
      (await c(`/api/activities/${pid}/restore`, { method: "POST" })).status,
    );
  codes.push((await c(`/api/activities/${pid}`, { method: "DELETE" })).status);
  check(
    codes.every((x) => x === 404),
    `private: ${who} not invited gets 404 on every route (${codes.join(",")})`,
  );
  check(
    !(await c("/api/activities")).json.some((a: Json) => a.id === pid),
    `private: not on the ${who}'s upcoming list`,
  );
  if (editor)
    check(
      (await c("/api/activities", { body: { ...pickle, date: privDay, replaceId: pid } })).status === 409,
      `private: an ${who} not invited can't cancel it through Replace`,
    );
}
// Those requests changed nothing.
const seen = (await guest.c(`/api/activities/${pid}`)).json;
check(
  seen.status === "published" &&
    seen.title === `Secret ${stamp}` &&
    seen.rsvps.length === 1 &&
    seen.messages.some((m: Json) => m.id === mid && m.body === "Bringing balls"),
  "private: nothing changed by people not invited",
);
check(
  (await guest.c("/api/activities")).json.find((a: Json) => a.id === pid)?.private === true,
  "private: on a guest's upcoming list, marked private",
);
const gcal = (await guest.c("/api/me/calendar", { method: "POST" })).json.calendarUrl as string;
check((await feed(gcal)).text.includes(`UID:${pid}@`), "private: in the calendar of a guest who is In");
// Invited Members answer and talk; only invited Editors change it, and only the creator (or an Admin) deletes it.
const pBase = () => creator.c(`/api/activities/${pid}`).then((r) => r.json.updatedAt as string);
const put = async (c: ReturnType<typeof client>, patch: Json) =>
  c(`/api/activities/${pid}`, { method: "PUT", body: { ...privBody, baseUpdatedAt: await pBase(), ...patch } });
check((await put(guest.c, {})).status === 403, "private: an invited Member can't edit it");
check((await guest.c(`/api/activities/${pid}`, { method: "DELETE" })).status === 403, "private: nor delete it");
check(
  (await put(coEditor.c, { title: `Secret two ${stamp}` })).json?.title === `Secret two ${stamp}`,
  "private: an invited Editor can edit it",
);
check(
  (await coEditor.c(`/api/activities/${pid}`, { method: "DELETE" })).status === 403,
  "private: an invited Editor who didn't create it can't delete it",
);
check(
  (
    await put(coEditor.c, {
      title: `Secret two ${stamp}`,
      guests: [coEditor.id, guest.id].filter((x) => x !== creator.id),
    })
  ).status === 200 && (await guest.c(`/api/activities/${pid}`)).json.guests.some((g: Json) => g.userId === creator.id),
  "private: the creator stays invited even if left off the list",
);
check(
  (await put(coEditor.c, { title: `Secret two ${stamp}`, guests: [guest.id] })).json?.guests?.some(
    (g: Json) => g.userId === coEditor.id,
  ),
  "private: the Editor saving stays invited",
);
check(
  (await put(coEditor.c, { title: `Secret two ${stamp}`, guests: undefined })).json?.private === true,
  "private: an edit that leaves out the guest list keeps it private",
);
{
  const open = await outEditor.c("/api/activities", {
    body: { ...pickle, title: `Open early ${stamp}`, date: privDay },
  });
  check(
    (await creator.c("/api/activities", { body: { ...privBody, title: `Swap ${stamp}`, replaceId: open.json.id } }))
      .status === 400 && (await outsider.c(`/api/activities/${open.json.id}`)).json.status === "published",
    "private: a private plan can't replace a public one",
  );
}
// Inviting the Admin, then removing the guest: the guest loses it, with their answer.
const pMoved = await put(creator.c, { title: `Secret two ${stamp}`, guests: [coEditor.id, adminId] });
check(
  pMoved.status === 200 && pMoved.json.rsvps.length === 0 && pMoved.json.guests.length === 3,
  "private: removing a guest takes their answer with them",
);
check(
  (await guest.c(`/api/activities/${pid}`)).status === 404 &&
    !(await guest.c("/api/activities")).json.some((a: Json) => a.id === pid) &&
    !(await feed(gcal)).text.includes(`UID:${pid}@`),
  "private: a removed guest no longer sees it, on the list or in their calendar",
);
check(
  (await guest.c(`/api/messages/${mid}`, { method: "PATCH", body: { body: "edited" } })).status === 404,
  "private: nor can they edit their old message",
);
check((await admin(`/api/activities/${pid}`)).status === 200, "private: an Admin sees it once invited");
// Past private activities stay with the people invited.
sql(`update activities set date = '${addDays(nyNow().date, -1)}' where id = '${pid}'`);
check(
  (await admin("/api/activities/past")).json.some((a: Json) => a.id === pid) &&
    !(await outEditor.c("/api/activities/past")).json.some((a: Json) => a.id === pid) &&
    !(await outsider.c("/api/activities/past")).json.some((a: Json) => a.id === pid),
  "private: History shows it to the people invited only",
);
sql(`update activities set date = '${privDay}' where id = '${pid}'`);
// Public is one-way.
const pPublic = await creator.c("/api/activities", { body: { ...pickle, title: `Open ${stamp}`, date: privDay } });
check(
  (
    await creator.c(`/api/activities/${pPublic.json.id}`, {
      method: "PUT",
      body: {
        ...pickle,
        title: `Open ${stamp}`,
        date: privDay,
        guests: [guest.id],
        baseUpdatedAt: pPublic.json.updatedAt,
      },
    })
  ).status === 400,
  "a public activity can't be made private",
);
const opened = await put(coEditor.c, { title: `Secret two ${stamp}`, makePublic: true });
check(
  opened.status === 200 && opened.json.private === false && opened.json.guests.length === 0,
  "private: an invited Editor can make it public",
);
check((await outsider.c(`/api/activities/${pid}`)).status === 200, "once public, everyone sees it");
// Delete: the creator (while an Editor) or an Admin; not another Editor.
check(
  (await outEditor.c(`/api/activities/${pPublic.json.id}`, { method: "DELETE" })).status === 403,
  "an Editor can't delete someone else's activity",
);
check(
  (await creator.c(`/api/activities/${pPublic.json.id}`, { method: "DELETE" })).status === 204,
  "the creator can delete their own activity",
);
check((await creator.c(`/api/activities/${pid}`, { method: "DELETE" })).status === 204, "and their private one");

// Online places (DESIGN.md → Virtual meet-ups): a meeting link instead of a pin; any sport, start and end, no weather.
{
  const zoomUrl = `https://us02web.zoom.us/j/8${Date.now() % 1e9}?pwd=abc`;
  const place = await creator.c("/api/spots", {
    body: { name: `Zoom ${stamp}`, link: zoomUrl, note: "Passcode 4242" },
  });
  check(
    place.status === 201 && place.json.online === true && place.json.maps_url === zoomUrl && place.json.lat === 0,
    "online: a meeting link makes an online place",
  );
  check(
    (await creator.c("/api/spots", { body: { name: `Bad ${stamp}`, link: "http://zoom.us/j/1", note: "" } })).status ===
      400,
    "online: only https meeting links",
  );
  const zid = place.json.id as string;
  const zDay = addDays(day, 5);
  const zoomRide = { ...plan, date: zDay, spotId: zid, online: true, routes: [], endTime: "20:00", startTime: "19:00" };
  check(
    (await creator.c("/api/activities", { body: { ...zoomRide, online: false } })).status === 400,
    "online: the app must plan it as online",
  );
  const zr = await creator.c("/api/activities", { body: zoomRide });
  check(
    zr.status === 201 && zr.json.online === true && zr.json.outdoor === false && zr.json.endTime === "20:00",
    "online: a ride without a route, with start and end, never outdoors",
  );
  const pk = await creator.c("/api/activities", {
    body: { ...pickle, title: `Zoom stretch ${stamp}`, date: zDay, spotId: zid, online: true, outdoor: true },
  });
  check(pk.status === 201 && pk.json.online === true && pk.json.outdoor === false, "online: any sport can be online");
  check(
    (await creator.c("/api/activities", { body: { ...plan, date: zDay, routes: [] } })).status === 400,
    "online: a ride at a real place still needs a route",
  );
  check(
    (await admin(`/api/spots/${zid}`, { method: "PATCH", body: { link: "41.0454, -73.6973" } })).status === 409,
    "online: a place in use can't switch between online and a pin",
  );
  check(
    (await admin(`/api/spots/${zid}`, { method: "PATCH", body: { note: "Passcode 4243" } })).json?.online === true,
    "online: editing its notes keeps it online",
  );
  const forecast = (await creator.c("/api/weather")).json;
  check(!(zid in (forecast?.forecast ?? {})), "online: no forecast for an online place");
  await guest.c(`/api/activities/${zr.json.id}/rsvp`, { method: "PUT", body: { status: "in", routeLabel: null } });
  const cal = await feed((await guest.c("/api/me/calendar", { method: "POST" })).json.calendarUrl);
  check(
    cal.text.includes(`UID:${zr.json.id}@`) && cal.text.replace(/\r\n /g, "").includes(`LOCATION:${zoomUrl}`),
    "online: the calendar event's location is the meeting link",
  );
  await admin(`/api/spots/${zid}`, { method: "PATCH", body: { archived: true } }); // keep the test pick lists short
}

// Announcements (DESIGN.md → Announcements): Admins post; everyone sees the active ones until they tap Got it.
{
  const post = {
    title: `Kit order ${stamp}`,
    body: "Closes Oct 31: https://bbt.team/kit",
    endsOn: null,
    notify: false,
  };
  check((await guest.c("/api/announcements", { body: post })).status === 403, "announcements: only Admins post");
  check(
    (await admin("/api/announcements", { body: { ...post, endsOn: addDays(nyNow().date, -1) } })).status === 400,
    "announcements: an end date in the past is refused",
  );
  const made = await admin("/api/announcements", { body: post });
  const aid = made.json?.id as string;
  check(made.status === 201 && Boolean(aid), "announcements: an Admin posts one");
  const mine = (await guest.c("/api/announcements")).json.find((a: Json) => a.id === aid);
  check(mine?.active === true && mine.seen === false, "announcements: a member sees it, not yet seen");
  check(
    (await admin("/api/announcements")).json.find((a: Json) => a.id === aid)?.seen === false,
    "announcements: the Admin who posted it sees the banner too",
  );
  const before = (await admin("/api/announcements/all")).json.find((a: Json) => a.id === aid);
  check(
    (await guest.c(`/api/announcements/${aid}/seen`, { method: "POST" })).status === 204 &&
      (await guest.c("/api/announcements")).json.find((a: Json) => a.id === aid)?.seen === true,
    "announcements: Got it is remembered",
  );
  const after = (await admin("/api/announcements/all")).json.find((a: Json) => a.id === aid);
  check(
    after?.seenCount === before?.seenCount + 1 && after.teamCount >= after.seenCount,
    "announcements: N of M got it",
  );
  const unseen = (await admin(`/api/announcements/${aid}/unseen`)).json as Json[];
  check(
    !unseen.some((p) => p.id === guest.id) && unseen.some((p) => p.id === outsider.id),
    "announcements: Admins see who hasn't seen it",
  );
  check(
    (await guest.c("/api/announcements/all")).status === 403 &&
      (await guest.c(`/api/announcements/${aid}/unseen`)).status === 403 &&
      (await guest.c(`/api/announcements/${aid}`, { method: "PUT", body: post })).status === 403 &&
      (await guest.c(`/api/announcements/${aid}/end`, { method: "POST" })).status === 403,
    "announcements: members can't list counts, edit or end them",
  );
  check(
    (await admin(`/api/announcements/${aid}`, { method: "PUT", body: { ...post, title: `Kit order closes ${stamp}` } }))
      .status === 204 &&
      (await guest.c("/api/announcements")).json.find((a: Json) => a.id === aid)?.title === `Kit order closes ${stamp}`,
    "announcements: an Admin edits one",
  );
  check(
    (await admin(`/api/announcements/${aid}/end`, { method: "POST" })).status === 204 &&
      (await outsider.c("/api/announcements")).json.find((a: Json) => a.id === aid)?.active === false,
    "announcements: End now takes it off the banner (it stays on the page)",
  );
  check(
    (await admin(`/api/announcements/${aid}`, { method: "PUT", body: post })).status === 404,
    "announcements: an ended one can't be edited",
  );
  check(
    (await guest.c("/api/announcements/no-such-id/seen", { method: "POST" })).status === 404,
    "announcements: Got it on an unknown one is refused",
  );
}

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
