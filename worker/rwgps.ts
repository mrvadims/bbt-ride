// RideWithGPS: fetch a route and simplify it to shared/ride.ts Route, cached in D1 `route_cache`.
// Public routes need no key. Private routes and library listing use the API key and auth token (Worker secrets);
// those endpoints are confirmed against the live API on first deploy (DESIGN.md → Data sources).
import { haversine, type Poi, type Route } from "../shared/ride.ts";
import { nowIso } from "./util.ts";

const MAX_POINTS = 350;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

interface RwgpsRoute {
  id: number;
  name: string;
  distance: number;
  elevation_gain: number;
  track_points: { x: number; y: number; e?: number; d?: number }[];
  points_of_interest?: { name: string; lat: number; lng: number; poi_type_name?: string }[];
}

function authHeaders(env: Env): HeadersInit {
  return {
    "x-rwgps-api-key": env.RWGPS_API_KEY,
    "x-rwgps-auth-token": env.RWGPS_AUTH_TOKEN,
    Accept: "application/json",
  };
}

async function fetchRaw(env: Env, id: number): Promise<RwgpsRoute | null> {
  try {
    const pub = await fetch(`https://ridewithgps.com/routes/${id}.json`, { headers: { Accept: "application/json" } });
    const res = pub.ok
      ? pub
      : await fetch(`https://ridewithgps.com/api/v1/routes/${id}.json`, { headers: authHeaders(env) });
    if (!res.ok) return null;
    const body = (await res.json()) as RwgpsRoute | { route: RwgpsRoute };
    const r = "route" in body ? body.route : body;
    return r?.track_points?.length ? r : null;
  } catch (err) {
    console.error(`RideWithGPS route ${id}:`, err); // network error: callers fall back to the cache
    return null;
  }
}

/** Thin the track to at most MAX_POINTS and place each POI at its nearest track point. */
export function simplify(r: RwgpsRoute): Route {
  const pts = r.track_points;
  const step = Math.max(1, Math.ceil(pts.length / MAX_POINTS));
  const keep = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const track: Route["track"] = keep.map((p) => [p.y, p.x, p.e ?? 0, p.d ?? 0]);
  const pois: Poi[] = (r.points_of_interest ?? []).map((poi) => {
    let best = { d: Number.POSITIVE_INFINITY, along: 0 };
    for (const p of pts) {
      const d = haversine(poi.lat, poi.lng, p.y, p.x);
      if (d < best.d) best = { d, along: p.d ?? 0 };
    }
    return {
      name: poi.name,
      type: poi.poi_type_name ?? "poi",
      lat: poi.lat,
      lng: poi.lng,
      route_d_m: Math.round(best.along),
      off_route_m: Math.round(best.d),
    };
  });
  return {
    id: r.id,
    name: r.name,
    url: `https://ridewithgps.com/routes/${r.id}`,
    distance_m: r.distance,
    elevation_gain_m: r.elevation_gain,
    track,
    pois,
  };
}

/** Cached route, refreshed weekly; null if RideWithGPS doesn't return it. */
export async function getRoute(env: Env, id: number): Promise<Route | null> {
  const row = await env.DB.prepare("select json, fetched_at from route_cache where rwgps_route_id = ?")
    .bind(id)
    .first<{ json: string | null; fetched_at: string | null }>();
  if (row?.json && row.fetched_at && Date.now() - Date.parse(row.fetched_at) < STALE_MS)
    return JSON.parse(row.json) as Route;
  const raw = await fetchRaw(env, id);
  if (!raw) return row?.json ? (JSON.parse(row.json) as Route) : null;
  const route = simplify(raw);
  await env.DB.prepare(
    `insert into route_cache (rwgps_route_id, name, json, fetched_at) values (?, ?, ?, ?)
     on conflict (rwgps_route_id) do update set name = excluded.name, json = excluded.json, fetched_at = excluded.fetched_at`,
  )
    .bind(id, route.name, JSON.stringify(route), nowIso())
    .run();
  return route;
}

/** Adds the captain's own routes to the library (best effort; runs from the scheduled job). */
export async function syncCaptainLibrary(env: Env): Promise<void> {
  const res = await fetch("https://ridewithgps.com/api/v1/routes.json?page=1&page_size=200", {
    headers: authHeaders(env),
  });
  if (!res.ok) return;
  const body = (await res.json()) as { routes?: { id: number; name: string }[] };
  const routes = body.routes ?? [];
  if (!routes.length) return;
  await env.DB.batch(
    routes.map((r) =>
      env.DB.prepare(
        `insert into route_cache (rwgps_route_id, name, in_library) values (?, ?, 1)
         on conflict (rwgps_route_id) do update set in_library = 1`,
      ).bind(r.id, r.name),
    ),
  );
}

/** Fetches up to `limit` library routes that haven't been fetched yet. */
export async function fillLibrary(env: Env, limit: number): Promise<void> {
  const { results } = await env.DB.prepare(
    "select rwgps_route_id as id from route_cache where in_library = 1 and json is null limit ?",
  )
    .bind(limit)
    .all<{ id: number }>();
  await Promise.allSettled(results.map((r) => getRoute(env, r.id)));
}
