// End-to-end API check against the LOCAL dev server (npm run dev, with local D1 migrated).
// Run: node scripts/smoke.ts  — it creates test users and rides in the local database only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const BASE = "http://localhost:8787";
if (!BASE.includes("localhost")) throw new Error("local only");
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

/** A client with its own cookie jar. */
function client() {
  let cookie = "";
  return async (path: string, init: { method?: string; body?: unknown; origin?: string | null } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": ip };
    if (cookie) headers.cookie = cookie;
    if (init.origin !== null) headers.origin = init.origin ?? BASE;
    const res = await fetch(BASE + path, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      redirect: "manual",
    });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
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

// Leftover test spots from an aborted run would change the cached-forecast key; keep the spot set stable.
sql("update spots set archived = 1 where name like 'Test spot %'");

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

check((await anon(`/api/links/${adminToken}`)).json?.kind === "invite", "invite link readable without a session");
const weak = await admin(`/api/links/${adminToken}`, { body: { name: "Admin", password: "short" } });
check(weak.status === 400, "short password refused");
const made = await admin(`/api/links/${adminToken}`, {
  body: { name: "Admin", username: `admin${stamp}`, password: "correct horse battery" },
});
check(made.status === 200, `admin account created from invite (${made.status})`);
const me = (await admin("/api/me")).json;
check(me?.role === "admin" && me.methods?.includes("password"), "admin signed in with Admin role and password method");
check((await anon(`/api/links/${adminToken}`)).status === 404, "invite link is single-use");

const inv = await admin("/api/users/invites", { body: { email: `rider-${stamp}@example.test`, role: "view" } });
check(inv.status === 201 && inv.json?.url?.includes("/invite/"), "admin creates an invite link");
check(
  (
    await rider(`/api/links/${tokenFromUrl(inv.json.url)}`, {
      body: { name: `Rider ${stamp}`, password: "pedal pedal pedal" },
    })
  ).status === 200,
  "rider joins",
);
check((await rider("/api/me")).json?.role === "view", "rider has View role");
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
  (await rider("/api/routes?q=katonah")).json?.some((r: Json) => r.id === 57406828),
  "route library search",
);

// Settings
check((await admin("/api/settings", { method: "PUT", body: { pace: 99 } })).status === 400, "invalid setting refused");
check(
  (await admin("/api/settings", { method: "PUT", body: { pace: 18 } })).json?.settings?.pace === 18,
  "admin changes a setting",
);
check(
  (await rider("/api/settings", { method: "PUT", body: { pace: 16 } })).status === 403,
  "rider can't change settings",
);
await admin("/api/settings/reset", { body: {} });

// Spots
const spot = await admin("/api/spots", {
  body: { name: `Test spot ${stamp}`, link: "javascript:alert(1)//@41.1,-73.7", note: "Lot B" },
});
check(
  spot.status === 201 && spot.json.maps_url.startsWith("https://www.google.com/maps/search/"),
  "unsafe link replaced by a coordinates link",
);
check(
  (await admin("/api/spots", { body: { name: `test SPOT ${stamp}`, link: "41.1, -73.7", note: "" } })).status === 409,
  "duplicate spot name refused",
);
check(
  (await rider("/api/spots", { body: { name: "Nope", link: "41.1, -73.7", note: "" } })).status === 403,
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

// Rides: a future date no earlier run used
const day = new Date(Date.now() + (400 + (Math.floor(Date.now() / 60000) % 20000)) * 864e5).toISOString().slice(0, 10); // unique per minute
const plan = {
  date: day,
  rollout: "08:30",
  spotId: "suny-purchase",
  pace: 17,
  notes: "Lights on",
  routes: [
    { label: "Full", routeId: 57406828, stop: "Tazza Cafe" },
    { label: "Short", routeId: 57426135, stop: null },
  ],
};
check((await rider("/api/rides", { body: plan })).status === 403, "rider can't publish");
const pub = await admin("/api/rides", { body: plan });
check(pub.status === 201 && pub.json.status === "published", "admin publishes a ride");
const id = pub.json.id;
check((await admin("/api/rides", { body: plan })).status === 409, "second ride on the same date needs replace");

let d = (await rider(`/api/rides/${id}/rsvp`, { method: "PUT", body: { status: "in", routeLabel: "Short" } })).json;
check(
  d.rsvps.some((r: Json) => r.name === `Rider ${stamp}` && r.routeLabel === "Short"),
  "rider RSVPs In on the Short route",
);
d = (await rider(`/api/rides/${id}/messages`, { body: { body: "Anyone driving from White Plains?" } })).json;
const msgId = d.messages.at(-1).id;
d = (await admin(`/api/rides/${id}/messages`, { body: { body: "I can take one", parentId: msgId } })).json;
check(d.messages.length === 2 && d.messages[1].parentId === msgId, "admin replies to the rider's message");
check(
  (await rider(`/api/rides/${id}/messages`, { body: { body: "nested", parentId: d.messages[1].id } })).status === 400,
  "replies are one level deep",
);
check(
  (await admin(`/api/messages/${msgId}`, { method: "PATCH", body: { body: "edited" } })).status === 403,
  "only the author edits a message",
);

const upd = await admin(`/api/rides/${id}`, { method: "PUT", body: { ...plan, rollout: "09:00" } });
check(upd.json?.lastUpdate?.text?.includes("roll-out 8:30 AM → 9:00 AM"), "update posts what changed");
check(upd.json.rsvps.length === 1, "RSVPs kept after an update");
let c = (await admin(`/api/rides/${id}/cancel`, { body: {} })).json;
check(
  c.status === "cancelled" && c.messages.some((m: Json) => m.kind === "cancel"),
  "cancel keeps the ride and posts a message",
);
c = (await admin(`/api/rides/${id}`, { method: "PUT", body: { ...plan, rollout: "09:00", notes: "still cancelled?" } }))
  .json;
check(c.status === "cancelled", "editing a cancelled ride keeps it cancelled");
check(
  (await rider(`/api/rides/${id}/rsvp`, { method: "PUT", body: { status: "out", routeLabel: null } })).status === 409,
  "no RSVP on a cancelled ride",
);
c = (await admin(`/api/rides/${id}/restore`, { body: {} })).json;
check(c.status === "published", "restore");
const rep = await admin("/api/rides", { body: { ...plan, notes: "new plan", replace: true } });
check(rep.status === 201, "replace publishes the new ride");
check(
  (await admin(`/api/rides/${id}`)).json.status === "cancelled",
  "…and cancels the old one, which keeps its history",
);
check(
  (await rider("/api/rides")).json.some((r: Json) => r.id === rep.json.id),
  "upcoming list includes the new ride",
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
const reset = await admin(`/api/users/${riderRow.id}/reset-link`, { body: {} });
const rider2 = client();
check(
  (await rider2(`/api/links/${tokenFromUrl(reset.json.url)}`, { body: { password: "new pedal pedal pedal" } }))
    .status === 200,
  "reset link sets a new password",
);
check((await rider("/api/me")).status === 401, "reset signs the rider out elsewhere");
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
