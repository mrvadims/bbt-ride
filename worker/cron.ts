// Scheduled job, every 3 hours (wrangler.jsonc → triggers): saves recorded weather on rides whose window has passed,
// and keeps the route library filled. Recorded weather is Open-Meteo's past hours at the spot (DESIGN.md → Past rides).
import type { RecordedWeather } from "../shared/api.ts";
import { type Route, rideTimes } from "../shared/ride.ts";
import { addDays, nyNow } from "../shared/time.ts";
import { at, fIdx, near, roadAt, toSeries } from "../shared/weather.ts";
import { loadSettings } from "./routes/settings.ts";
import { fetchForecast } from "./routes/weather.ts";
import { fillLibrary, getRoute, syncCaptainLibrary } from "./rwgps.ts";

export async function recordWeather(env: Env): Promise<void> {
  const now = nyNow();
  // past_days=2 covers yesterday and the day before; older rides without data stay without it.
  const { results: rides } = await env.DB.prepare(
    `select r.id, r.date, r.rollout, r.pace_mph, s.id as spot_id, s.lat, s.lng,
            (select rwgps_route_id from ride_routes where ride_id = r.id order by sort limit 1) as route_id,
            (select stop_poi from ride_routes where ride_id = r.id order by sort limit 1) as stop
     from rides r join spots s on s.id = r.spot_id
     where r.status = 'published' and r.observed_json is null and r.date between ? and ?`,
  )
    .bind(addDays(now.date, -2), now.date)
    .all<{
      id: string;
      date: string;
      rollout: string;
      pace_mph: number;
      spot_id: string;
      lat: number;
      lng: number;
      route_id: number;
      stop: string | null;
    }>();
  if (!rides.length) return;
  const s = await loadSettings(env.DB);
  const done: { id: string; rec: RecordedWeather }[] = [];
  const spots = [...new Map(rides.map((r) => [r.spot_id, { id: r.spot_id, lat: r.lat, lng: r.lng }])).values()];
  const data = await fetchForecast(spots);
  for (const r of rides) {
    const route: Route | null = await getRoute(env, r.route_id);
    const t = route ? rideTimes(route, r.rollout, r.pace_mph, r.stop, s) : null;
    if (!t || (r.date === now.date && t.end > now.min)) continue; // ride window not over yet
    const om = data[spots.findIndex((x) => x.id === r.spot_id)];
    if (!om) continue;
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

export async function scheduled(env: Env): Promise<void> {
  await Promise.allSettled([recordWeather(env), syncCaptainLibrary(env).then(() => fillLibrary(env, 20))]);
}
