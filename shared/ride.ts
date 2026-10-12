// Ride data shapes and ETA math (DESIGN.md → ETA math).
import type { Settings } from "./settings.ts";
import { hhmmToMin } from "./time.ts";

export const M_PER_MI = 1609.344;
export const FT_PER_M = 3.28084;

export interface Poi {
  name: string;
  type: string; // RWGPS poi_type_name, e.g. "coffee"
  lat: number;
  lng: number;
  route_d_m: number; // distance along the route, metres
  off_route_m: number;
}

export interface Route {
  id: number;
  name: string;
  url: string;
  distance_m: number;
  elevation_gain_m: number;
  track: [number, number, number, number][]; // lat, lng, elevation m, distance m
  pois: Poi[];
}

export interface Spot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  maps_url: string;
  note: string;
}

export interface RideRoute {
  label: string; // "Main", or e.g. "Full" / "Short"
  routeId: number;
  stop: string | null; // POI name of the coffee stop
}

interface RideTimes {
  distMi: number;
  movingH: number;
  regroupMin: number;
  start: number; // minutes after midnight
  end: number;
  climbFt: number;
  stop: { poi: Poi; mile: number; eta: number; len: number } | null;
}

/** k = 1 + regroup buffer; ETA at mile m = meet time + (m ÷ pace) × k; the stop adds its length. */
export function rideTimes(
  route: Route,
  meetTime: string,
  pace: number,
  stopName: string | null,
  s: Settings,
): RideTimes {
  const distMi = route.distance_m / M_PER_MI;
  const movingH = distMi / pace;
  const k = 1 + s.regroupPct / 100;
  const start = hhmmToMin(meetTime);
  const poi = stopName ? (route.pois.find((p) => p.name === stopName) ?? null) : null;
  const len = poi ? s.stopMin : 0;
  return {
    distMi,
    movingH,
    regroupMin: movingH * 60 * (k - 1),
    start,
    end: start + movingH * 60 * k + len,
    climbFt: route.elevation_gain_m * FT_PER_M,
    stop: poi
      ? { poi, mile: poi.route_d_m / M_PER_MI, eta: etaAt(poi.route_d_m / M_PER_MI, start, pace, s), len }
      : null,
  };
}

export const etaAt = (mile: number, start: number, pace: number, s: Settings): number =>
  start + (mile / pace) * 60 * (1 + s.regroupPct / 100);

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const t = Math.PI / 180;
  const x =
    Math.sin(((lat2 - lat1) * t) / 2) ** 2 +
    Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin(((lng2 - lng1) * t) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}

/** Distance (m) from a route's first track point to a spot. */
/** The point nearest to lat/lng, e.g. the start spot a route begins at. */
export function nearest<T extends { lat: number; lng: number }>(lat: number, lng: number, points: T[]): T | undefined {
  let best: { p: T; d: number } | undefined;
  for (const p of points) {
    const d = haversine(lat, lng, p.lat, p.lng);
    if (!best || d < best.d) best = { p, d };
  }
  return best?.p;
}

export function startDistance(route: Route, spot: Spot): number {
  const [lat, lng] = route.track[0] ?? [spot.lat, spot.lng];
  return haversine(lat, lng, spot.lat, spot.lng);
}

/** Google Maps link parsing: pin (!3d…!4d…), then query/search path, then map centre (@), then "lat, lng". */
export function parseLatLng(input: string): { lat: number; lng: number } | null {
  const v = input.trim();
  const n = "(-?\\d+\\.\\d+)";
  const m =
    v.match(new RegExp(`!3d${n}!4d${n}`)) ??
    v.match(new RegExp(`(?:[?&](?:q|query|ll|destination)=|/search/)${n}(?:,|%2C)[\\s+]*${n}`, "i")) ??
    v.match(new RegExp(`@${n},${n}`)) ??
    v.match(new RegExp(`^${n}\\s*,\\s*${n}$`));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export const mapsLink = (lat: number, lng: number): string =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
