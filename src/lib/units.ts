// Display formatting in the rider's units. All data is imperial (°F, mph, mi, ft, in); metric converts for display only.
import { FT_PER_M, M_PER_MI } from "../../shared/ride.ts";
import type { Prefs } from "./prefs.ts";

const KM_PER_MI = M_PER_MI / 1000;

export function units(u: Prefs["units"]) {
  const m = u === "metric";
  const r = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "–" : String(Math.round(v)));
  return {
    temp: (f: number | null | undefined) => `${r(f == null ? f : m ? ((f - 32) * 5) / 9 : f)}°`,
    tempDelta: (f: number) => `${r(m ? (f * 5) / 9 : f)}°`, // a difference, e.g. "warms up 7°"
    speed: (mph: number | null | undefined) => r(mph == null ? mph : m ? mph * KM_PER_MI : mph),
    speedUnit: m ? "km/h" : "mph",
    dist: (mi: number, digits = 1) => `${(m ? mi * KM_PER_MI : mi).toFixed(digits)} ${m ? "km" : "mi"}`,
    distUnit: m ? "km" : "mi",
    mi: (mi: number) => (m ? mi * KM_PER_MI : mi), // a distance in the rider's unit, for charts
    marker: (mi: number) => (m ? `km ${(mi * KM_PER_MI).toFixed(1)}` : `mile ${mi.toFixed(1)}`), // a point along a route
    short: (meters: number) => (m ? `${Math.round(meters)} m` : `${Math.round(meters * FT_PER_M)} ft`),
    elev: (ft: number) => `${Math.round(m ? ft / FT_PER_M : ft).toLocaleString()} ${m ? "m" : "ft"}`,
    rain: (inches: number) => {
      if (m) {
        const mm = inches * 25.4;
        return `${mm < 0.1 ? "0" : mm < 10 ? mm.toFixed(1) : Math.round(mm)} mm`;
      }
      return `${inches < 0.005 ? "0" : inches < 0.1 ? inches.toFixed(2) : inches.toFixed(1)}"`;
    },
  };
}
export type Units = ReturnType<typeof units>;
