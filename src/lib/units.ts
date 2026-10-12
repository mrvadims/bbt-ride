// Display formatting in the rider's units. All data is imperial (°F, mph, mi, ft, in); metric converts for display only.
import type { Prefs } from "./prefs.ts";

export function units(u: Prefs["units"]) {
  const m = u === "metric";
  const r = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "–" : String(Math.round(v)));
  return {
    temp: (f: number | null | undefined) => `${r(f == null ? f : m ? ((f - 32) * 5) / 9 : f)}°`,
    speed: (mph: number | null | undefined) => r(mph == null ? mph : m ? mph * 1.609344 : mph),
    speedUnit: m ? "km/h" : "mph",
    dist: (mi: number, digits = 1) => `${(m ? mi * 1.609344 : mi).toFixed(digits)} ${m ? "km" : "mi"}`,
    distUnit: m ? "km" : "mi",
    elev: (ft: number) => `${Math.round(m ? ft / 3.28084 : ft).toLocaleString()} ${m ? "m" : "ft"}`,
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
