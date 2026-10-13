// Sports and what each one needs (DESIGN.md → v2): route and pace, indoor option, weather group, labels.
import { z } from "zod";

export const SPORTS = ["ride", "run", "swim", "pickleball", "ski", "other"] as const;
export type Sport = (typeof SPORTS)[number];
/** Sports an Admin can turn off; Other is always offered. */
export const TOGGLE_SPORTS = SPORTS.filter((s) => s !== "other");

export const SPORT_LABEL: Record<Sport, string> = {
  ride: "Ride",
  run: "Run",
  swim: "Swim",
  pickleball: "Pickleball",
  ski: "Ski",
  other: "Other",
};

/** Ride and run follow a RideWithGPS route at a pace; their end time comes from the route. */
export const hasRoute = (s: Sport): boolean => s === "ride" || s === "run";
/** Sports that can be planned indoors (no weather check), with the labels for the two choices. */
export const SETTING_LABELS: Partial<Record<Sport, [indoor: string, outdoor: string]>> = {
  swim: ["Pool", "Open water"],
  pickleball: ["Indoor", "Outdoor"],
  other: ["Indoor", "Outdoor"],
};
export const canBeIndoor = (s: Sport): boolean => s in SETTING_LABELS;

export const START_LABEL: Record<Sport, string> = {
  ride: "Meet time",
  run: "Meet time",
  swim: "Start time",
  pickleball: "Start time",
  ski: "Carpool leaves",
  other: "Start time",
};
/** Default length for sports without a route, minutes. */
export const DEFAULT_LENGTH_MIN: Record<Sport, number> = {
  ride: 180,
  run: 90,
  swim: 60,
  pickleball: 120,
  ski: 600,
  other: 120,
};
export const DETAILS_HINT: Partial<Record<Sport, string>> = {
  swim: "e.g. Lanes 3–4",
  pickleball: "e.g. 2 courts",
  ski: "e.g. Carpool from SUNY Purchase",
  other: "Anything people should know at a glance",
};

/** Pace limits in mph (a run's min/mi is converted). */
export const PACE_RANGE: Record<"ride" | "run", [number, number]> = { ride: [10, 25], run: [4, 12] };

// ---- weather ----
export const GROUPS = ["ride", "run", "ski", "outdoor"] as const;
export type Group = (typeof GROUPS)[number];
export const GROUP_LABEL: Record<Group, string> = {
  ride: "Ride",
  run: "Run",
  ski: "Ski",
  outdoor: "Other outdoor",
};
export const groupOf = (s: Sport): Group => (s === "ride" || s === "run" || s === "ski" ? s : "outdoor");

/** Amber and red thresholds for one weather group. Cold uses the group's feel (bike feel, run feel or real feel). */
export const warnSchema = z.object({
  feelCaution: z.number(), // cold: feel below (°F)
  feelNoGo: z.number(),
  heatCaution: z.number(), // heat: real feel at or above (°F)
  heatNoGo: z.number(),
  windCaution: z.number().min(0), // mph
  windNoGo: z.number().min(0),
  gustCaution: z.number().min(0),
  gustNoGo: z.number().min(0),
  rainProbCaution: z.number().min(0).max(100), // %
  rainProbNoGo: z.number().min(0).max(100),
  rainAmtCaution: z.number().min(0), // inches in the window
  rainAmtNoGo: z.number().min(0),
});
export type Warn = z.infer<typeof warnSchema>;

const w = (
  feel: [number, number],
  heat: [number, number],
  wind: [number, number],
  gust: [number, number],
  rainProb: [number, number],
  rainAmt: [number, number],
): Warn => ({
  feelCaution: feel[0],
  feelNoGo: feel[1],
  heatCaution: heat[0],
  heatNoGo: heat[1],
  windCaution: wind[0],
  windNoGo: wind[1],
  gustCaution: gust[0],
  gustNoGo: gust[1],
  rainProbCaution: rainProb[0],
  rainProbNoGo: rainProb[1],
  rainAmtCaution: rainAmt[0],
  rainAmtNoGo: rainAmt[1],
});
// Ride keeps v1's thresholds; the others are first guesses, to be tuned like v1's.
export const DEFAULT_WARN: Record<Group, Warn> = {
  ride: w([40, 32], [92, 100], [15, 22], [25, 35], [30, 60], [0.01, 0.05]),
  run: w([30, 15], [82, 90], [18, 25], [30, 40], [50, 80], [0.05, 0.2]),
  ski: w([5, -10], [60, 70], [20, 30], [30, 45], [40, 70], [0.02, 0.1]),
  outdoor: w([45, 35], [90, 98], [15, 22], [25, 35], [30, 60], [0.01, 0.05]),
};

/** What the weather check uses for one activity. */
export interface Rules {
  pace: number; // airflow from moving, mph (0 for sports done in place)
  road: boolean; // road wetness warnings (rides)
  lowLight: boolean; // start near sunrise (ride and run)
  warn: Warn;
}
export const rulesFor = (sport: Sport, paceMph: number, warn: Record<Group, Warn>): Rules => ({
  pace: hasRoute(sport) ? paceMph : 0,
  road: sport === "ride",
  lowLight: hasRoute(sport),
  warn: warn[groupOf(sport)],
});

/** "9:00" min/mi ↔ mph, for runs. */
export const minPerMile = (mph: number): string => {
  const s = Math.round(3600 / mph);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export const mphFromMinPerMile = (v: string): number | null => {
  const m = v.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const sec = Number(m[1]) * 60 + Number(m[2]);
  return sec > 0 ? 3600 / sec : null;
};
