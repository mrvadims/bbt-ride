// GET /api/weather: Open-Meteo forecast for every active spot (KV, 30 min) and NWS alerts (KV, 10 min), cached per spot.
import { Hono } from "hono";
import type { WeatherData } from "../../shared/api.ts";
import { TZ } from "../../shared/time.ts";
import { type Alert, HOURLY_VARS, type OpenMeteoResponse } from "../../shared/weather.ts";
import type { AppEnv } from "../app.ts";
import { fail } from "../util.ts";

const NWS_HEADERS = { "User-Agent": "BBT Ride (info@bbt.team)", Accept: "application/geo+json" };

interface SpotPoint {
  id: string;
  lat: number;
  lng: number;
}

interface Cached<T> {
  at: number;
  value: T;
}
type Entries<T> = Record<string, Cached<T>>; // by spot id

const KEEP_MS = 6 * 3600_000; // a last good copy stays usable this long while an upstream is down
const pin = (s: SpotPoint) => `${s.id}:${s.lat}:${s.lng}`; // moving a pin starts that spot afresh

/**
 * One KV entry per kind holding a value per spot. When any spot is older than `freshMs` (or new), all are refreshed in
 * one `load` call, so they stay on one cycle and each refresh is one write. If it fails, each spot keeps its last good
 * copy (up to 6 h) and a spot without one is left out, so one bad spot or an outage never blanks the rest.
 */
export async function perSpot<T>(
  kv: KVNamespace,
  kind: string,
  spots: SpotPoint[],
  freshMs: number,
  load: (spots: SpotPoint[]) => Promise<(T | undefined)[]>,
): Promise<Entries<T>> {
  const stored = (await kv.get<Record<string, Cached<T>>>(kind, "json")) ?? {};
  const now = Date.now();
  const out: Entries<T> = {};
  for (const s of spots) {
    const hit = stored[pin(s)];
    if (hit && now - hit.at < KEEP_MS) out[s.id] = hit;
  }
  if (spots.every((s) => out[s.id] && now - (out[s.id] as Cached<T>).at < freshMs)) return out;
  try {
    const values = await load(spots);
    spots.forEach((s, i) => {
      const value = values[i];
      if (value !== undefined) out[s.id] = { at: now, value };
    });
    const next = Object.fromEntries(spots.flatMap((s) => (out[s.id] ? [[pin(s), out[s.id]]] : [])));
    await kv.put(kind, JSON.stringify(next));
  } catch (err) {
    console.error(`${kind} refresh failed; serving the last good copies`, err);
  }
  return out;
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
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`).catch(() => null);
  if (!res?.ok) fail(502, `Weather service unavailable${res ? ` (HTTP ${res.status})` : ""}`);
  const data = (await (res as Response).json()) as OpenMeteoResponse | OpenMeteoResponse[];
  return Array.isArray(data) ? data : [data];
}

const ALERT_KINDS = /(Warning|Watch|Advisory)$/;
async function fetchAlerts(s: SpotPoint): Promise<Alert[]> {
  const url = `https://api.weather.gov/alerts/active?point=${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
  const res = await fetch(url, { headers: NWS_HEADERS }).catch(() => null);
  if (!res?.ok) return []; // alerts are a bonus; the forecast still works without them
  const body = (await res.json()) as { features?: { properties: { event: string; headline: string | null } }[] };
  return (body.features ?? [])
    .map((f) => f.properties)
    .filter((p) => ALERT_KINDS.test(p.event))
    .map((p) => ({ event: p.event, headline: p.headline ?? p.event, level: p.event.endsWith("Warning") ? 2 : 1 }));
}

/** Forecast for every active spot (by spot id), refreshed every 30 minutes. Used by /api/weather and the scheduled job. */
export async function spotForecasts(env: Env) {
  const { results: spots } = await env.DB.prepare(
    "select id, lat, lng from spots where archived = 0 order by name",
  ).all<SpotPoint>();
  const entries = await perSpot(env.CACHE, "forecast", spots, 30 * 60_000, fetchForecast);
  const oldest = Math.min(...Object.values(entries).map((e) => e.at)); // so "updated" never overstates freshness
  return {
    spots,
    fetchedAt: new Date(Number.isFinite(oldest) ? oldest : Date.now()).toISOString(),
    byId: Object.fromEntries(Object.entries(entries).map(([id, e]) => [id, e.value])),
  };
}

export const weather = new Hono<AppEnv>().get("/", async (c) => {
  const { spots, fetchedAt, byId } = await spotForecasts(c.env);
  const alerts = await perSpot(c.env.CACHE, "alerts", spots, 10 * 60_000, (all) => Promise.all(all.map(fetchAlerts)));
  return c.json<WeatherData>({
    fetchedAt,
    forecast: byId,
    alerts: Object.fromEntries(spots.map((s) => [s.id, alerts[s.id]?.value ?? []])),
  });
});
