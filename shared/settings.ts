import { z } from "zod";
import { DEFAULT_WARN, GROUP_LABEL, GROUPS, type Group, TOGGLE_SPORTS, warnSchema } from "./sports.ts";

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/; // "08:30"

// Team settings (Admin-editable, stored in D1 `settings`, one row per key). Imperial units.
export const settingsSchema = z.object({
  sports: z // sports offered in Plan (Other always is)
    .array(z.enum(TOGGLE_SPORTS))
    .refine((s) => new Set(s).size === s.length, "Each sport once"),
  pace: z.number().min(10).max(25), // ride pace, mph
  meetTime: z.string().regex(HHMM),
  durationH: z.number().min(0.5).max(8), // weather window before a route is picked
  stopMin: z.number().int().min(0).max(60), // coffee stop length
  regroupPct: z.number().min(0).max(30), // % of moving time
  lookback: z.number().int().min(1).max(48), // road wetness look-back, hours
  wetMm: z.number().min(0).max(2),
  dryingMm: z.number().min(0).max(2),
  warn: z.object({ ride: warnSchema, run: warnSchema, ski: warnSchema, outdoor: warnSchema }), // per weather group
});

export type Settings = z.infer<typeof settingsSchema>;
/** A settings change: any keys, and only the weather groups that change (merged with the stored ones). */
export const settingsChange = settingsSchema.extend({ warn: settingsSchema.shape.warn.partial() }).partial();
export type SettingsChange = z.infer<typeof settingsChange>;

/** What's inconsistent across settings (red must be beyond amber; drying below wet), or null. */
export function settingsProblem(s: Settings): string | null {
  for (const g of GROUPS as readonly Group[]) {
    const w = s.warn[g];
    const at = `${GROUP_LABEL[g]} weather`;
    if (w.feelNoGo >= w.feelCaution) return `${at}, cold: the red threshold must be below the amber one.`;
    if (w.heatNoGo <= w.heatCaution) return `${at}, heat: the red threshold must be above the amber one.`;
    for (const [name, a, r] of [
      ["wind", w.windCaution, w.windNoGo],
      ["gusts", w.gustCaution, w.gustNoGo],
      ["rain chance", w.rainProbCaution, w.rainProbNoGo],
      ["rain amount", w.rainAmtCaution, w.rainAmtNoGo],
    ] as const)
      if (r <= a) return `${at}, ${name}: the red threshold must be above the amber one.`;
  }
  if (s.dryingMm >= s.wetMm) return "Road wetness: Drying must start below Wet.";
  return null;
}

export const DEFAULT_SETTINGS: Settings = {
  sports: ["ride", "run", "swim", "triathlon", "pickleball", "ski"],
  pace: 17,
  meetTime: "08:30",
  durationH: 3,
  stopMin: 20,
  regroupPct: 5,
  lookback: 12,
  wetMm: 0.5,
  dryingMm: 0.1,
  warn: DEFAULT_WARN,
};

// Fixed by design (DESIGN.md → Settings), not settings.
export const LOW_LIGHT_MIN = 30; // meet time within this many minutes of sunrise
export const WIND_VEST_MPH = 12;
export const SHED_DEG = 8;
