// Scheduled job, every 3 hours (wrangler.jsonc → triggers): saves recorded weather on outdoor activities whose window has
// passed, keeps the route library filled and clears expired records. Recorded weather is Open-Meteo's past hours at the
// spot (DESIGN.md → Past rides).
import type { RecordedWeather } from "../shared/api.ts";
import { rideTimes } from "../shared/ride.ts";
import { addDays, hhmmToMin, nyNow } from "../shared/time.ts";
import { at, fIdx, near, roadAt, toSeries } from "../shared/weather.ts";
import { loadSettings } from "./routes/settings.ts";
import { spotForecasts } from "./routes/weather.ts";
import { fillLibrary, getRoute, syncCaptainLibrary } from "./rwgps.ts";

async function recordWeather(env: Env): Promise<void> {
  const now = nyNow();
  // past_days=2 covers yesterday and the day before; older activities without data stay without it.
  const { results: rows } = await env.DB.prepare(
    `select a.id, a.date, a.start_time, a.end_time, a.pace_mph, a.spot_id,
            (select rwgps_route_id from activity_routes where activity_id = a.id order by sort limit 1) as route_id,
            (select stop_poi from activity_routes where activity_id = a.id order by sort limit 1) as stop
     from activities a
     where a.status = 'published' and a.outdoor = 1 and a.observed_json is null and a.date between ? and ?`,
  )
    .bind(addDays(now.date, -2), now.date)
    .all<{
      id: string;
      date: string;
      start_time: string;
      end_time: string | null;
      pace_mph: number;
      spot_id: string;
      route_id: number | null;
      stop: string | null;
    }>();
  if (!rows.length) return;
  const s = await loadSettings(env.DB);
  const done: { id: string; rec: RecordedWeather }[] = [];
  const { byId } = await spotForecasts(env); // includes the past two days (past_days=2)
  for (const r of rows) {
    // Ride and run end when their route says; other sports at their end time.
    const route = r.route_id ? await getRoute(env, r.route_id) : null;
    const start = hhmmToMin(r.start_time);
    const end = route
      ? rideTimes(route, r.start_time, r.pace_mph, r.stop, s).end
      : r.end_time
        ? hhmmToMin(r.end_time)
        : null;
    if (end == null || (r.date === now.date && end > now.min)) continue; // window not over yet
    const om = byId[r.spot_id];
    if (!om) continue; // no forecast this run; the next run tries again
    const se = toSeries(om);
    const f = fIdx(se, r.date, start);
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
        env.DB.prepare("update activities set observed_json = ? where id = ?").bind(JSON.stringify(d.rec), d.id),
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
