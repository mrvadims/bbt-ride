// Kit chart: bands on minimum bike feel (after the rider's offset), plus add-ons (DESIGN.md → Kit chart).
import { type Settings, SHED_DEG, WIND_VEST_MPH } from "./settings.ts";
import type { WindowStats } from "./weather.ts";

export interface KitBand {
  minFeel: number; // lowest bike feel for this band, °F; the last band uses -99
  name: string;
  items: string[];
}

export const DEFAULT_KIT: KitBand[] = [
  {
    minFeel: 70,
    name: "Summer",
    items: ["Short-sleeve jersey", "Bib shorts", "Light socks", "Sunglasses + sunscreen"],
  },
  { minFeel: 60, name: "Mild", items: ["Short-sleeve jersey", "Bib shorts", "Arm warmers for the start (optional)"] },
  {
    minFeel: 52,
    name: "Cool",
    items: ["Short-sleeve jersey + arm warmers", "Bib shorts + knee warmers", "Wind vest", "Light gloves"],
  },
  {
    minFeel: 45,
    name: "Chilly",
    items: ["Base layer", "Long-sleeve jersey", "Knee warmers or 3/4 bibs", "Wind vest", "Full-finger gloves"],
  },
  {
    minFeel: 38,
    name: "Cold",
    items: [
      "Long-sleeve base layer",
      "Thermal jersey",
      "Bib tights",
      "Wind vest",
      "Full-finger gloves",
      "Headband or cap",
      "Toe covers",
    ],
  },
  {
    minFeel: 30,
    name: "Very cold",
    items: ["Thermal base layer", "Thermal jacket", "Thermal tights", "Winter gloves", "Skull cap", "Shoe covers"],
  },
  {
    minFeel: -99,
    name: "Deep winter",
    items: [
      "Thermal base layer",
      "Winter jacket",
      "Thermal tights",
      "Lobster gloves",
      "Balaclava",
      "Winter shoe covers",
    ],
  },
];

export const KIT_OFFSETS = { cold: -5, avg: 0, hot: 5 } as const;
export type KitOffset = keyof typeof KIT_OFFSETS;

/** Bands are sorted warmest first; the last one catches everything. */
export const kitBand = (kit: KitBand[], feel: number): KitBand =>
  kit.find((b) => feel >= b.minFeel) ?? (kit[kit.length - 1] as KitBand);

type KitAddOn =
  | { kind: "rainJacket"; pp: number; rain: number }
  | { kind: "fenders"; road: "Drying" | "Wet" }
  | { kind: "windVest"; ws: number }
  | { kind: "thunder" };

export interface KitAdvice {
  band: KitBand; // dress for the coldest part of the ride
  addOns: KitAddOn[];
  shed: { spread: number; to: KitBand } | null; // it warms up: pack layers to shed down to `to`
  offset: number;
}

export function kitAdvice(st: WindowStats, kit: KitBand[], offset: KitOffset, s: Settings): KitAdvice {
  const off = KIT_OFFSETS[offset];
  const band = kitBand(kit, st.feelMin + off);
  const warmest = kitBand(kit, st.feelMax + off);
  const addOns: KitAddOn[] = [];
  if (st.ppMax >= s.rainProbCaution || st.rain >= s.rainAmtCaution)
    addOns.push({ kind: "rainJacket", pp: st.ppMax, rain: st.rain });
  if (st.road.state !== "Dry") addOns.push({ kind: "fenders", road: st.road.state });
  if (st.wsMax >= WIND_VEST_MPH && !band.items.some((i) => /wind vest/i.test(i)))
    addOns.push({ kind: "windVest", ws: st.wsMax });
  if (st.thunder) addOns.push({ kind: "thunder" });
  const spread = st.feelMax - st.feelMin;
  const shed = st.warms && warmest !== band && spread >= SHED_DEG ? { spread, to: warmest } : null;
  return { band, addOns, shed, offset: off };
}
