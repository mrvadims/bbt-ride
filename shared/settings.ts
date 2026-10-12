import { z } from "zod";

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/; // "08:30"

// Team settings (Admin-editable, stored in D1 `settings`, one row per key). Imperial units.
export const settingsSchema = z.object({
  pace: z.number().min(10).max(25), // mph
  meetTime: z.string().regex(HHMM),
  durationH: z.number().min(0.5).max(8), // weather window before a route is picked
  stopMin: z.number().int().min(0).max(60), // coffee stop length
  regroupPct: z.number().min(0).max(30), // % of moving time
  lookback: z.number().int().min(1).max(48), // road wetness look-back, hours
  wetMm: z.number().min(0).max(2),
  dryingMm: z.number().min(0).max(2),
  feelCaution: z.number(), // cold: bike feel below (°F)
  feelNoGo: z.number(),
  heatCaution: z.number(), // heat: real feel at or above (°F)
  heatNoGo: z.number(),
  windCaution: z.number().min(0), // mph
  windNoGo: z.number().min(0),
  gustCaution: z.number().min(0),
  gustNoGo: z.number().min(0),
  rainProbCaution: z.number().min(0).max(100), // %
  rainProbNoGo: z.number().min(0).max(100),
  rainAmtCaution: z.number().min(0), // inches in the ride window
  rainAmtNoGo: z.number().min(0),
});

export type Settings = z.infer<typeof settingsSchema>;

/** What's inconsistent across settings (red must be beyond amber; drying below wet), or null. */
export function settingsProblem(s: Settings): string | null {
  if (s.feelNoGo >= s.feelCaution) return "Cold: the red threshold must be below the amber one.";
  if (s.heatNoGo <= s.heatCaution) return "Heat: the red threshold must be above the amber one.";
  for (const [name, a, r] of [
    ["Wind", s.windCaution, s.windNoGo],
    ["Gusts", s.gustCaution, s.gustNoGo],
    ["Rain chance", s.rainProbCaution, s.rainProbNoGo],
    ["Rain amount", s.rainAmtCaution, s.rainAmtNoGo],
  ] as const)
    if (r <= a) return `${name}: the red threshold must be above the amber one.`;
  if (s.dryingMm >= s.wetMm) return "Road wetness: Drying must start below Wet.";
  return null;
}

export const DEFAULT_SETTINGS: Settings = {
  pace: 17,
  meetTime: "08:30",
  durationH: 3,
  stopMin: 20,
  regroupPct: 5,
  lookback: 12,
  wetMm: 0.5,
  dryingMm: 0.1,
  feelCaution: 40,
  feelNoGo: 32,
  heatCaution: 92,
  heatNoGo: 100,
  windCaution: 15,
  windNoGo: 22,
  gustCaution: 25,
  gustNoGo: 35,
  rainProbCaution: 30,
  rainProbNoGo: 60,
  rainAmtCaution: 0.01,
  rainAmtNoGo: 0.05,
};

// Fixed by design (DESIGN.md → Settings), not settings.
export const LOW_LIGHT_MIN = 30; // meet time within this many minutes of sunrise
export const WIND_VEST_MPH = 12;
export const SHED_DEG = 8;
