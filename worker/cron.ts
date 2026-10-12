// Scheduled job, every 3 hours (wrangler.jsonc → triggers): saves recorded weather on rides whose window has passed,
// keeps the route library filled and clears expired records. Recorded weather is Open-Meteo's past hours at the spot
// (DESIGN.md → Past rides).
import type { RecordedWeather } from "../shared/api.ts";
import { type Route, rideTimes } from "../shared/ride.ts";
import { addDays, nyNow } from "../shared/time.ts";
import { at, fIdx, near, roadAt, toSeries } from "../shared/weather.ts";
import { loadSettings } from "./routes/settings.ts";
import { spotForecasts } from "./routes/weather.ts";
import { fillLibrary, getRoute, syncCaptainLibrary } from "./rwgps.ts";

async function recordWeather(env: Env): Promise<void> {
  const now = nyNow();
  // past_days=2 covers yesterday and the day before; older rides without data stay without it.
  const { results: rides } = await env.DB.prepare(
    `select r.id, r.date, r.meet_time, r.pace_mph, r.spot_id,
            (select rwgps_route_id from ride_routes where ride_id = r.id order by sort limit 1) as route_id,
            (select stop_poi from ride_routes where ride_id = r.id order by sort limit 1) as stop
     from rides r
     where r.status = 'published' and r.observed_json is null and r.date between ? and ?`,
  )
    .bind(addDays(now.date, -2), now.date)
    .all<{
      id: string;
      date: string;
      meet_time: string;
      pace_mph: number;
      spot_id: string;
      route_id: number;
      stop: string | null;
    }>();
  if (!rides.length) return;
  const s = await loadSettings(env.DB);
  const done: { id: string; rec: RecordedWeather }[] = [];
  const { byId } = await spotForecasts(env); // includes the past two days (past_days=2)
  for (const r of rides) {
    const route: Route | null = await getRoute(env, r.route_id);
    const t = route ? rideTimes(route, r.meet_time, r.pace_mph, r.stop, s) : null;
    if (!t || (r.date === now.date && t.end > now.min)) continue; // ride window not over yet
    const om = byId[r.spot_id];
    if (!om) continue; // no forecast this run; the next run tries again
    const se = toSeries(om);
    const f = fIdx(se, r.date, t.start);
    if (f == null) continue;
    const road = roadAt(se, f, s);
    const T = at(se.T, f);
    const ws = at(se.ws, f);
    if (T == null || ws == null) continue;
    done.push({
      id: r.id,
      rec: {
        T,
        app: at(se.app, f) ?? T,
        ws,
        wg: at(se.wg, f) ?? ws,
        rain: road.rainIn,
        road: road.state,
        code: near(se.code, f) ?? 0,
      },
    });
  }
  if (done.length) {
    await env.DB.batch(
      done.map((d) =>
        env.DB.prepare("update rides set observed_json = ? where id = ?").bind(JSON.stringify(d.rec), d.id),
      ),
    );
  }
}

/** Drops expired sessions and links, finished sign-in attempts, and rate-limit counters older than a day. */
async function cleanUp(env: Env): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`delete from "session" where "expiresAt" < ?`).bind(now),
    env.DB.prepare(`delete from "verification" where "expiresAt" < ?`).bind(now),
    env.DB.prepare(`delete from "rateLimit" where "lastRequest" < ?`).bind(Date.now() - 24 * 60 * 60 * 1000),
    env.DB.prepare("delete from links where expires_at < ?").bind(now),
  ]);
}

// One task after another, recorded weather first. Two library routes per run keeps the job well inside the Workers
// free plan's limits (50 outbound requests and about 10 ms of CPU per run).
export async function scheduled(env: Env): Promise<void> {
  for (const task of [
    () => recordWeather(env),
    () => syncCaptainLibrary(env),
    () => fillLibrary(env, 2),
    () => cleanUp(env),
  ]) {
    await task().catch((err) => console.error("scheduled job:", err));
  }
}
