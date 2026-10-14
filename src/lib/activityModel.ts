// Everything the activity page and the Plan preview compute for one activity: route and times, weather window,
// warnings and (rides) kit.
import type { Activity } from "../../shared/api.ts";
import { kitAdvice } from "../../shared/kit.ts";
import { type RideRoute, type RideTimes, type Route, rideTimes } from "../../shared/ride.ts";
import { hasRoute, rulesFor } from "../../shared/sports.ts";
import { hhmmToMin } from "../../shared/time.ts";
import { evaluate, warnings } from "../../shared/weather.ts";
import { type SpotWithState, useRoute, useSpots, useTeam, useWeather } from "./data.ts";
import { usePrefs } from "./prefs.ts";

/** The fields the model needs (a published activity or a draft from Plan). */
export type ActivityLike = Pick<
  Activity,
  | "sport"
  | "icon"
  | "title"
  | "date"
  | "startTime"
  | "endTime"
  | "spotId"
  | "outdoor"
  | "pace"
  | "details"
  | "notes"
  | "routes"
  | "status"
>;

export function useActivityModel(act: ActivityLike | null, routeIndex = 0) {
  const prefs = usePrefs();
  const team = useTeam().data;
  const spots = useSpots().data;
  const weather = useWeather().data;
  // Ride and run have a main route and at most one alternate; both are loaded so names and the switcher are ready.
  const mainQ = useRoute(act?.routes[0]?.routeId);
  const altQ = useRoute(act?.routes[1]?.routeId);
  const main = mainQ.data;
  const alt = altQ.data;
  if (!act || !team || !spots) return null;
  // The alternate shows only if it loads; otherwise the main route stands in.
  const idx = routeIndex > 0 && act.routes.length > 1 && !altQ.isError ? 1 : 0;
  const rt: RideRoute | undefined = act.routes[idx];
  const route = (idx === 1 ? alt : main) ?? null;
  const spot: SpotWithState | undefined = spots.find((s) => s.id === act.spotId);
  // A route that can't be loaded (private, deleted) leaves the page without route details instead of loading forever.
  const routed = hasRoute(act.sport) && !mainQ.isError;
  if (!spot || (routed && (!rt || !route))) return { loading: true as const };
  const s = team.settings;
  const ride: RideTimes | null = routed && route && rt ? rideTimes(route, act.startTime, act.pace, rt.stop, s) : null;
  const start = hhmmToMin(act.startTime);
  const end = ride ? ride.end : act.endTime ? hhmmToMin(act.endTime) : start + s.durationH * 60;
  const rules = rulesFor(act.sport, act.pace, s.warn);
  const se = act.outdoor ? weather?.series[spot.id] : undefined;
  const ev = se ? evaluate(se, act.date, start, end - start, rules, s) : null;
  return {
    loading: false as const,
    spot,
    route,
    routeById: (id: number): Route | undefined => [main, alt].find((r) => r?.id === id),
    start,
    end,
    ride, // ride and run: distance, moving time, coffee stop
    rules,
    se,
    ev,
    warnings: ev && se ? warnings(ev, se, act.date, start, rules, weather?.alerts[spot.id] ?? []) : [],
    kit: ev && act.sport === "ride" ? kitAdvice(ev.st, team.kit, prefs.kitOffset, s) : null,
    settings: s,
  };
}
export type ActivityModel = Exclude<ReturnType<typeof useActivityModel>, null | { loading: true }>;
