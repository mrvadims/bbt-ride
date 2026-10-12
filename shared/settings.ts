import { z } from "zod";

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/; // "08:30"

// Team settings (Admin-editable, stored in D1 `settings`, one row per key). Imperial units.
export const settingsSchema = z.object({
  pace: z.number().min(10).max(25), // mph
  rollout: z.string().regex(HHMM),
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

export const DEFAULT_SETTINGS: Settings = {
  pace: 17,
  rollout: "08:30",
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
export const LOW_LIGHT_MIN = 30; // roll-out within this many minutes of sunrise
export const WIND_VEST_MPH = 12;
export const SHED_DEG = 8;
