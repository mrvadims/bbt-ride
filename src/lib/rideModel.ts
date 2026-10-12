// Everything the ride page and the Plan preview compute for one ride: routes, times, weather window, warnings, kit.
import type { RideSummary } from "../../shared/api.ts";
import { kitAdvice } from "../../shared/kit.ts";
import { type RideRoute, type Route, rideTimes } from "../../shared/ride.ts";
import { evaluate, warnings } from "../../shared/weather.ts";
import { type SpotWithState, useRoute, useSpots, useTeam, useWeather } from "./data.ts";
import { usePrefs } from "./prefs.ts";

/** The ride fields the model needs (a published ride or a draft from Plan). */
export type RideLike = Pick<RideSummary, "date" | "rollout" | "spotId" | "pace" | "notes" | "routes" | "status">;

export function useRideModel(ride: RideLike | null, routeIndex = 0) {
  const prefs = usePrefs();
  const team = useTeam().data;
  const spots = useSpots().data;
  const weather = useWeather().data;
  // A ride has a main route and at most one alternate; both are loaded so names and the switcher are ready.
  const main = useRoute(ride?.routes[0]?.routeId).data;
  const alt = useRoute(ride?.routes[1]?.routeId).data;
  const idx = ride && routeIndex > 0 && ride.routes.length > 1 ? 1 : 0;
  const rt: RideRoute | undefined = ride?.routes[idx];
  const route = idx === 1 ? alt : main;
  if (!ride || !rt || !team || !spots) return null;
  const spot: SpotWithState | undefined = spots.find((s) => s.id === ride.spotId);
  if (!spot || !route) return { loading: true as const };
  const s = team.settings;
  const t = rideTimes(route, ride.rollout, ride.pace, rt.stop, s);
  const se = weather?.series[spot.id];
  const ev = se ? evaluate(se, ride.date, t.start, t.end - t.start, ride.pace, s) : null;
  return {
    loading: false as const,
    spot,
    route,
    routeById: (id: number): Route | undefined => [main, alt].find((r) => r?.id === id),
    t,
    se,
    ev,
    warnings: ev && se ? warnings(ev, se, ride.date, t.start, weather?.alerts[spot.id] ?? []) : [],
    kit: ev ? kitAdvice(ev.st, team.kit, prefs.kitOffset, s) : null,
    settings: s,
  };
}
export type RideModel = Exclude<ReturnType<typeof useRideModel>, null | { loading: true }>;
