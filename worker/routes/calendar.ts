// The calendar link (DESIGN.md → v2, Calendar link): a private, signed feed of everything one person is in for.
// GET /api/cal/<user>.<version>.<signature>.ics needs no session (calendar apps can't sign in), so it carries only that
// person's own activities and no messages. Nothing secret is stored: the signature is an HMAC of (user, version) with the
// Worker's secret, and Reset bumps the version.
import { Hono } from "hono";
import { type Activity, activityName } from "../../shared/api.ts";
import { activityEvent, type CalEvent, icsCalendar } from "../../shared/ics.ts";
import { type Route, rideTimes } from "../../shared/ride.ts";
import { SPORT_LABEL, timedByRoute } from "../../shared/sports.ts";
import { addDays, hhmmToMin, nyNow } from "../../shared/time.ts";
import type { AppEnv } from "../app.ts";
import { b64url } from "../util.ts";
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
  return b64url(mac.slice(0, 18));
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

/** Makes the link if there isn't one yet (asking twice gives the same link). */
export const makeCalendarLink = (env: Env, userId: string) =>
  env.DB.prepare(
    "insert into calendar_links (user_id, version, created_at) values (?, 1, ?) on conflict (user_id) do nothing",
  ).bind(userId, new Date().toISOString());

/** A new link; the old one stops working. Also used when someone is disabled, so re-enabling doesn't revive it. */
export const resetCalendarLink = (env: Env, userId: string) =>
  env.DB.prepare("update calendar_links set version = version + 1, created_at = ? where user_id = ?").bind(
    new Date().toISOString(),
    userId,
  );

async function feed(env: Env, userId: string): Promise<string> {
  // The newest 100 (upcoming ones matter most), then back in date order.
  const acts = (
    await summaries(
      env.DB,
      userId, // a private activity only while they're invited
      "a.date >= ? and exists (select 1 from rsvps v where v.activity_id = a.id and v.user_id = ? and v.status = 'in')",
      [addDays(nyNow().date, -PAST_DAYS), userId],
      "a.date desc, a.start_time desc",
      100,
    )
  ).reverse();
  if (!acts.length) return icsCalendar([], true);
  // Polled by calendar apps, so it never calls RideWithGPS: the end time comes from cached routes only (distance and
  // stops, extracted by D1), and route links are built from the id.
  const mains = [
    ...new Set(acts.flatMap((a) => (timedByRoute(a.sport, a.online) && a.routes[0] ? [a.routes[0].routeId] : []))),
  ];
  const [s, spots, cached] = await Promise.all([
    loadSettings(env.DB),
    env.DB.prepare("select id, name, lat, lng, maps_url, note, online from spots").all<
      Omit<Spot, "online"> & { online: number }
    >(),
    mains.length
      ? env.DB.prepare(
          `select rwgps_route_id as id, json_extract(json, '$.distance_m') as d, json_extract(json, '$.pois') as pois
           from route_cache where json is not null and rwgps_route_id in (${mains.map(() => "?").join(",")})`,
        )
          .bind(...mains)
          .all<{ id: number; d: number; pois: string }>()
      : null,
  ]);
  const routes = new Map(
    (cached?.results ?? []).map((r) => [
      r.id,
      { distance_m: r.d, pois: JSON.parse(r.pois ?? "[]"), elevation_gain_m: 0, track: [] } as unknown as Route,
    ]),
  );
  const events: CalEvent[] = [];
  for (const a of acts) {
    const row = spots.results.find((x) => x.id === a.spotId);
    if (!row) continue;
    const spot = { ...row, online: row.online === 1 };
    events.push({ ...eventOf(a, spot, s, routes), url: `${env.BETTER_AUTH_URL}/a/${a.id}` });
  }
  return icsCalendar(events, true);
}

type Spot = Parameters<typeof activityEvent>[0]["spot"] & { id: string };

function eventOf(
  a: Activity,
  spot: Spot,
  s: Awaited<ReturnType<typeof loadSettings>>,
  routes: Map<number, Route>,
): CalEvent {
  const start = hhmmToMin(a.startTime);
  const main = timedByRoute(a.sport, a.online) && a.routes[0] ? routes.get(a.routes[0].routeId) : undefined;
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
      meet: timedByRoute(a.sport, a.online),
      spot,
      routes: a.routes.map((r) => ({
        label: r.label,
        name: r.name ?? `#${r.routeId}`,
        url: `https://ridewithgps.com/routes/${r.routeId}`,
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
  const version = Number(v);
  // The signature is checked first, so a forged link costs no database read and every refusal looks the same.
  if (!Number.isSafeInteger(version) || !same(sig, await sign(c.env.SESSION_SECRET, userId, version)))
    return c.text("Not found", 404);
  const row = await c.env.DB.prepare(
    `select 1 as ok from calendar_links l join "user" u on u.id = l.user_id
     where l.user_id = ? and l.version = ? and coalesce(u.banned, 0) = 0`,
  )
    .bind(userId, version)
    .first<{ ok: number }>();
  if (!row) return c.text("Not found", 404);
  return c.body(await feed(c.env, userId), 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Cache-Control": "private, max-age=300",
    "X-Robots-Tag": "noindex",
  });
});
