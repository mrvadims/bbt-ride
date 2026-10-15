// GET /api/weather: Open-Meteo forecast (KV, 30 min) and NWS alerts (KV, 10 min), cached per spot, for every active spot
// and archived spots that activities still use.
import { Hono } from "hono";
import type { WeatherData } from "../../shared/api.ts";
import { addDays, nyNow, TZ } from "../../shared/time.ts";
import { type Alert, HOURLY_VARS, type OpenMeteoResponse } from "../../shared/weather.ts";
import type { AppEnv } from "../app.ts";
import { fail } from "../util.ts";

const NWS_HEADERS = { "User-Agent": "BBT (info@bbt.team)", Accept: "application/geo+json" };

interface SpotPoint {
  id: string;
  lat: number;
  lng: number;
}

interface Cached<T> {
  at: number; // when this value was fetched
  value: T;
}
interface Stored<T> {
  tried: number; // the last refresh attempt, successful or not
  pins: string[]; // the spots it covered
  values: Record<string, Cached<T>>; // by pin
}

const KEEP_MS = 6 * 3600_000; // a last good copy stays usable this long while an upstream is down
const pin = (s: SpotPoint) => `${s.id}:${s.lat}:${s.lng}`; // moving a pin starts that spot afresh

/**
 * One KV entry per kind holding a value per spot. Every `freshMs`, or when a spot is added or moved, all spots are
 * refreshed in one `load` call. A spot whose refresh fails keeps its last good copy (up to 6 h); a spot without one is
 * left out, so one bad spot or an outage never blanks the rest. Failed attempts count too, so an outage costs one try
 * and one write per `freshMs`, like normal operation.
 */
export async function perSpot<T>(
  kv: KVNamespace,
  kind: string,
  spots: SpotPoint[],
  freshMs: number,
  load: (spots: SpotPoint[]) => Promise<(T | undefined)[]>,
): Promise<Record<string, T>> {
  const stored = await kv.get<Stored<T>>(kind, "json");
  const now = Date.now();
  const values: Record<string, Cached<T>> = {};
  for (const s of spots) {
    const hit = stored?.values?.[pin(s)];
    if (hit && now - hit.at < KEEP_MS) values[pin(s)] = hit;
  }
  const due = !stored || now - stored.tried >= freshMs || spots.some((s) => !stored.pins?.includes(pin(s)));
  if (due && spots.length) {
    const fetched = await load(spots).catch((err) => {
      console.error(`${kind} refresh failed; serving the last good copies`, err);
      return [];
    });
    spots.forEach((s, i) => {
      const value = fetched[i];
      if (value !== undefined) values[pin(s)] = { at: now, value };
    });
    // A failed write (KV allows about one write per second per key) only means the next request refreshes again.
    await kv
      .put(kind, JSON.stringify({ tried: now, pins: spots.map(pin), values } satisfies Stored<T>))
      .catch((err) => console.error(`${kind} cache write failed`, err));
  }
  return Object.fromEntries(spots.flatMap((s) => (values[pin(s)] ? [[s.id, values[pin(s)]?.value as T]] : [])));
}

/** One multi-location Open-Meteo request; `past_days=2` supplies recent rain and recorded weather. */
async function fetchForecast(spots: SpotPoint[]): Promise<OpenMeteoResponse[]> {
  const params = new URLSearchParams({
    latitude: spots.map((s) => s.lat.toFixed(4)).join(","),
    longitude: spots.map((s) => s.lng.toFixed(4)).join(","),
    hourly: HOURLY_VARS.join(","),
    daily: "sunrise",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: TZ,
    past_days: "2",
    forecast_days: "8",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) {
    await res?.body?.cancel();
    return fail(502, `Weather service unavailable${res ? ` (HTTP ${res.status})` : ""}`);
  }
  const data = (await res.json()) as OpenMeteoResponse | OpenMeteoResponse[];
  return Array.isArray(data) ? data : [data];
}

const ALERT_KINDS = /(Warning|Watch|Advisory)$/;
/** Active alerts at the spot, or undefined when NWS is unreachable (the spot then keeps its last good copy). */
async function fetchAlerts(s: SpotPoint): Promise<Alert[] | undefined> {
  const url = `https://api.weather.gov/alerts/active?point=${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
  const res = await fetch(url, { headers: NWS_HEADERS, signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!res?.ok) {
    await res?.body?.cancel();
    return undefined;
  }
  const body = (await res.json()) as { features?: { properties: { event: string; headline: string | null } }[] };
  // NWS can list the same event more than once for a point (several zones or updates): keep one of each.
  const byEvent = new Map<string, Alert>();
  for (const { properties: p } of body.features ?? [])
    if (ALERT_KINDS.test(p.event) && !byEvent.has(p.event))
      byEvent.set(p.event, {
        event: p.event,
        headline: p.headline ?? p.event,
        level: p.event.endsWith("Warning") ? 2 : 1,
      });
  return [...byEvent.values()];
}

/**
 * Forecast for every active spot, plus archived spots that recent or upcoming activities still use (by spot id), refreshed
 * every 30 minutes. Used by /api/weather and the scheduled job (recorded weather).
 */
export async function spotForecasts(env: Env) {
  const { results: spots } = await env.DB.prepare(
    `select id, lat, lng from spots
     where online = 0 and (archived = 0 or id in (select spot_id from activities where status = 'published' and date >= ?))
     order by name`,
  )
    .bind(addDays(nyNow().date, -2))
    .all<SpotPoint>();
  return { spots, byId: await perSpot(env.CACHE, "forecast", spots, 30 * 60_000, fetchForecast) };
}

export const weather = new Hono<AppEnv>().get("/", async (c) => {
  const { spots, byId } = await spotForecasts(c.env);
  const alerts = await perSpot(c.env.CACHE, "alerts", spots, 10 * 60_000, (all) => Promise.all(all.map(fetchAlerts)));
  return c.json<WeatherData>({
    forecast: byId,
    alerts: Object.fromEntries(spots.map((s) => [s.id, alerts[s.id] ?? []])),
  });
});
