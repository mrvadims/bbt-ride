// GET /api/weather: Open-Meteo forecast for every active spot (one request, KV 30 min) and NWS alerts (KV 10 min).
import { Hono } from "hono";
import type { WeatherData } from "../../shared/api.ts";
import { TZ } from "../../shared/time.ts";
import { type Alert, HOURLY_VARS, type OpenMeteoResponse } from "../../shared/weather.ts";
import type { AppEnv } from "../app.ts";
import { fail, sha256Hex } from "../util.ts";

export const NWS_HEADERS = { "User-Agent": "BBT Ride (info@bbt.team)", Accept: "application/geo+json" };

interface SpotPoint {
  id: string;
  lat: number;
  lng: number;
}

async function cached<T>(kv: KVNamespace, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = await kv.get<T>(key, "json");
  if (hit) return hit;
  const value = await load();
  await kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
  return value;
}

/** One multi-location Open-Meteo request; `past_days=2` supplies recent rain and recorded weather. */
export async function fetchForecast(spots: SpotPoint[]): Promise<OpenMeteoResponse[]> {
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
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) fail(502, `Open-Meteo HTTP ${res.status}`);
  const data = (await res.json()) as OpenMeteoResponse | OpenMeteoResponse[];
  return Array.isArray(data) ? data : [data];
}

const ALERT_KINDS = /(Warning|Watch|Advisory)$/;
async function fetchAlerts(s: SpotPoint): Promise<Alert[]> {
  const res = await fetch(`https://api.weather.gov/alerts/active?point=${s.lat.toFixed(4)},${s.lng.toFixed(4)}`, {
    headers: NWS_HEADERS,
  });
  if (!res.ok) return []; // alerts are a bonus; the forecast still works without them
  const body = (await res.json()) as { features?: { properties: { event: string; headline: string | null } }[] };
  return (body.features ?? [])
    .map((f) => f.properties)
    .filter((p) => ALERT_KINDS.test(p.event))
    .map((p) => ({ event: p.event, headline: p.headline ?? p.event, level: p.event.endsWith("Warning") ? 2 : 1 }));
}

export const weather = new Hono<AppEnv>().get("/", async (c) => {
  const { results: spots } = await c.env.DB.prepare(
    "select id, lat, lng from spots where archived = 0 order by name",
  ).all<SpotPoint>();
  if (!spots.length) return c.json<WeatherData>({ fetchedAt: new Date().toISOString(), forecast: {}, alerts: {} });
  const key = await sha256Hex(spots.map((s) => `${s.id}:${s.lat}:${s.lng}`).join("|"));
  const forecast = await cached(c.env.CACHE, `forecast:${key}`, 30 * 60, async () => ({
    fetchedAt: new Date().toISOString(),
    data: await fetchForecast(spots),
  }));
  const alerts = await cached(c.env.CACHE, `alerts:${key}`, 10 * 60, async () => Promise.all(spots.map(fetchAlerts)));
  return c.json<WeatherData>({
    fetchedAt: forecast.fetchedAt,
    forecast: Object.fromEntries(spots.flatMap((s, i) => (forecast.data[i] ? [[s.id, forecast.data[i]]] : []))),
    alerts: Object.fromEntries(spots.map((s, i) => [s.id, alerts[i] ?? []])),
  });
});
