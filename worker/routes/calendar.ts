// The calendar link (DESIGN.md → v2, Calendar link): a private, signed feed of everything one person is in for.
// GET /api/cal/<user>.<version>.<signature>.ics needs no session (calendar apps can't sign in), so it carries only that
// person's own activities and no messages. Nothing secret is stored: the signature is an HMAC of (user, version) with the
// Worker's secret, and Reset bumps the version.
import { Hono } from "hono";
import { type Activity, activityName } from "../../shared/api.ts";
import { activityEvent, type CalEvent, icsCalendar } from "../../shared/ics.ts";
import { rideTimes } from "../../shared/ride.ts";
import { hasRoute, SPORT_LABEL } from "../../shared/sports.ts";
import { addDays, hhmmToMin, nyNow } from "../../shared/time.ts";
import type { AppEnv } from "../app.ts";
import { getRoute } from "../rwgps.ts";
import { summaries } from "./activities.ts";
import { loadSettings } from "./settings.ts";

const PAST_DAYS = 30;

async function sign(secret: string, userId: string, version: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`cal:${userId}:${version}`)),
  );
  return btoa(String.fromCharCode(...mac.slice(0, 18)))
    .replaceAll("+", "-")
    .replaceAll("/", "_");
}

/** Compares without stopping at the first difference, so timing doesn't reveal how much of a signature was right. */
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The person's calendar link, or null if they haven't made one. */
export async function calendarUrl(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare("select version from calendar_links where user_id = ?")
    .bind(userId)
    .first<{ version: number }>();
  return row
    ? `${env.BETTER_AUTH_URL}/api/cal/${userId}.${row.version}.${await sign(env.SESSION_SECRET, userId, row.version)}.ics`
    : null;
}

/** Makes the link, or a new one (the old one stops working). */
export async function resetCalendarLink(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    `insert into calendar_links (user_id, version, created_at) values (?, 1, ?)
     on conflict (user_id) do update set version = version + 1, created_at = excluded.created_at`,
  )
    .bind(userId, new Date().toISOString())
    .run();
}

async function feed(env: Env, userId: string): Promise<string> {
  const acts = await summaries(
    env.DB,
    "a.date >= ? and exists (select 1 from rsvps v where v.activity_id = a.id and v.user_id = ? and v.status = 'in')",
    [addDays(nyNow().date, -PAST_DAYS), userId],
    "a.date, a.start_time",
    100,
  );
  if (!acts.length) return icsCalendar([], true);
  const s = await loadSettings(env.DB);
  const { results: spots } = await env.DB.prepare("select id, name, lat, lng, maps_url, note from spots").all<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    maps_url: string;
    note: string;
  }>();
  const events: CalEvent[] = [];
  for (const a of acts) {
    const spot = spots.find((x) => x.id === a.spotId);
    if (!spot) continue;
    events.push({ ...(await eventOf(env, a, spot, s)), url: `${env.BETTER_AUTH_URL}/a/${a.id}` });
  }
  return icsCalendar(events, true);
}

async function eventOf(
  env: Env,
  a: Activity,
  spot: Parameters<typeof activityEvent>[0]["spot"],
  s: Awaited<ReturnType<typeof loadSettings>>,
): Promise<CalEvent> {
  const start = hhmmToMin(a.startTime);
  const routes = hasRoute(a.sport) ? await Promise.all(a.routes.map((r) => getRoute(env, r.routeId))) : [];
  const main = routes[0];
  const end = main
    ? rideTimes(main, a.startTime, a.pace, a.routes[0]?.stop ?? null, s).end
    : a.endTime
      ? hhmmToMin(a.endTime)
      : start + s.durationH * 60;
  return {
    ...activityEvent({
      id: a.id,
      sport: SPORT_LABEL[a.sport].toLowerCase(),
      name: activityName(a),
      date: a.date,
      start,
      end,
      meet: hasRoute(a.sport),
      spot,
      routes: a.routes.map((r, i) => ({
        label: r.label,
        name: routes[i]?.name ?? r.name ?? `#${r.routeId}`,
        url: routes[i]?.url ?? "",
      })),
      details: a.details,
      notes: a.notes,
    }),
    cancelled: a.status === "cancelled",
    updatedAt: a.updatedAt,
  };
}

export const calendar = new Hono<AppEnv>().get("/:token{[A-Za-z0-9_-]+\\.\\d+\\.[A-Za-z0-9_-]+\\.ics}", async (c) => {
  const [userId = "", v = "", sig = ""] = c.req
    .param("token")
    .replace(/\.ics$/, "")
    .split(".");
  const row = await c.env.DB.prepare(
    `select l.version from calendar_links l join "user" u on u.id = l.user_id
     where l.user_id = ? and coalesce(u.banned, 0) = 0`,
  )
    .bind(userId)
    .first<{ version: number }>();
  // Same answer for an unknown person, an old version and a wrong signature.
  if (!row || String(row.version) !== v || !same(sig, await sign(c.env.SESSION_SECRET, userId, row.version)))
    return c.text("Not found", 404);
  return c.body(await feed(c.env, userId), 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Cache-Control": "private, max-age=300",
  });
});
