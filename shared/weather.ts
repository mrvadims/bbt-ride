// Weather algorithms (DESIGN.md → Algorithms). Inputs are Open-Meteo hourly values in °F, mph and inches,
// America/New_York local time. precipitation at hour h is the total for the hour ending at h.
import { LOW_LIGHT_MIN, type Settings } from "./settings.ts";
import { fmtTime, hhmmToMin, pad } from "./time.ts";

export const MM_PER_IN = 25.4;
export const HOURLY_VARS = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation",
  "precipitation_probability",
  "weather_code",
  "cloud_cover",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "dew_point_2m",
  "shortwave_radiation",
  "is_day",
] as const;

/** One Open-Meteo location response (the fields we request). */
export interface OpenMeteoResponse {
  hourly: { time: string[] } & Record<(typeof HOURLY_VARS)[number], (number | null)[]>;
  daily?: { time: string[]; sunrise: string[] };
}

type Col = (number | null)[];
export interface Series {
  time: string[];
  idx: Map<string, number>;
  T: Col;
  app: Col;
  p: Col;
  pp: Col;
  code: Col;
  cloud: Col;
  ws: Col;
  wd: Col;
  wg: Col;
  dew: Col;
  sw: Col;
  day: Col;
  sunrise: Map<string, number>; // date → minutes after midnight
}

export function toSeries(o: OpenMeteoResponse): Series {
  const h = o.hourly;
  const sunrise = new Map<string, number>();
  o.daily?.time.forEach((d, i) => {
    const s = o.daily?.sunrise[i];
    if (s) sunrise.set(d, hhmmToMin(s.slice(11, 16)));
  });
  return {
    time: h.time,
    idx: new Map(h.time.map((t, i) => [t, i])),
    T: h.temperature_2m,
    app: h.apparent_temperature,
    p: h.precipitation,
    pp: h.precipitation_probability,
    code: h.weather_code,
    cloud: h.cloud_cover,
    ws: h.wind_speed_10m,
    wd: h.wind_direction_10m,
    wg: h.wind_gusts_10m,
    dew: h.dew_point_2m,
    sw: h.shortwave_radiation,
    day: h.is_day,
    sunrise,
  };
}

/** Fractional hourly index for a wall-clock date + minutes; looks up the hour itself, so DST days line up. */
export function fIdx(se: Series, date: string, min: number): number | null {
  if (!Number.isFinite(min)) return null;
  const h = Math.floor(min / 60);
  const day0 = se.idx.get(`${date}T00:00`);
  const i = se.idx.get(`${date}T${pad(h)}:00`) ?? (day0 == null ? null : day0 + h);
  if (i == null) return null;
  const f = i + (min - h * 60) / 60;
  return f > se.time.length - 1 ? null : f;
}

/** Linear interpolation between hours. */
export function at(col: Col, f: number): number | null {
  const i = Math.floor(f);
  const r = f - i;
  const a = col[i];
  if (a == null) return null;
  const b = col[i + 1];
  if (r === 0 || b == null) return a;
  return a + (b - a) * r;
}

/** Nearest hour (wind direction, weather code, rain chance). */
export const near = (col: Col, f: number): number | null => col[Math.min(col.length - 1, Math.round(f))] ?? null;

// Bike feel: NWS wind chill with relative airflow √(pace² + wind²); tapered to zero between 50–70 °F; real feel above.
export function windChill(T: number, V: number): number {
  const v = V ** 0.16;
  return 35.74 + 0.6215 * T - 35.75 * v + 0.4275 * T * v;
}
export function bikeFeel(T: number, wind: number, app: number | null, pace: number): number {
  const V = Math.sqrt(pace * pace + wind * wind);
  if (V < 3) return T;
  if (T <= 50) return Math.min(T, windChill(T, V));
  if (T < 70) return T + ((windChill(50, V) - 50) * (70 - T)) / 20;
  return app ?? T;
}

/** Water-film drying for hour i, mm/h. */
export function dryingRate(se: Series, i: number): number {
  const T = se.T[i] ?? 50;
  const dew = se.dew[i] ?? T;
  const ws = se.ws[i] ?? 0;
  const Tc = ((T - 32) * 5) / 9;
  const spread = Math.max(0, ((T - dew) * 5) / 9);
  const sw = se.sw[i] ?? (se.day[i] ? (1 - (se.cloud[i] ?? 0) / 100) * 600 : 0);
  let d = (0.02 + 0.004 * Math.max(0, Tc) + 0.015 * Math.min(spread, 15) + 0.0006 * sw) * (1 + 0.03 * Math.min(ws, 20));
  if (spread < 1) d *= 0.25; // near-saturated air: dew, barely any evaporation
  if ((se.p[i] ?? 0) * MM_PER_IN > 0.1) d *= 0.2; // still raining this hour
  return d;
}

export type RoadState = "Dry" | "Drying" | "Wet";
export type Level = 0 | 1 | 2; // none, amber, red
export interface Road {
  state: RoadState;
  rainIn: number; // rain in the look-back window
  rained: boolean;
  level: Level;
}

/** Road wetness at fractional index f: water-film bucket over the look-back window. */
export function roadAt(se: Series, f: number, s: Settings): Road {
  const end = Math.floor(f);
  let W = 0;
  let rainIn = 0;
  let rained = false;
  for (let i = Math.max(0, end - s.lookback + 1); i <= end; i++) {
    const pin = se.p[i] ?? 0;
    rainIn += pin;
    if (pin >= 0.005) rained = true;
    W = Math.min(2, W + pin * MM_PER_IN);
    W = Math.max(0, W - dryingRate(se, i));
  }
  const raining = (se.p[Math.ceil(f)] ?? 0) >= 0.01;
  const state: RoadState = raining || W >= s.wetMm ? "Wet" : W >= s.dryingMm ? "Drying" : "Dry";
  return { state, rainIn, rained, level: state === "Wet" ? 2 : state === "Drying" ? 1 : 0 };
}

const lvl3 = (v: number, caution: number, noGo: number, higherWorse = true): Level =>
  higherWorse ? (v >= noGo ? 2 : v >= caution ? 1 : 0) : v < noGo ? 2 : v < caution ? 1 : 0;

export interface WindowStats {
  tMin: number;
  tMax: number;
  appMin: number;
  appMax: number;
  feelMin: number;
  feelMax: number;
  wsMax: number;
  wgMax: number;
  ppMax: number;
  rain: number; // inches in the window
  dir: number;
  road: Road;
  roadEnd: Road;
  thunder: boolean;
  warms: boolean; // bike feel at the finish above the start
}
export type Factor = "Road" | "Cold" | "Heat" | "Wind" | "Rain";
export interface Evaluation {
  st: WindowStats;
  factors: { k: Factor; level: Level }[];
  f0: number;
  f1: number;
}

/** Ride window at a forecast point: stats over 15-minute samples plus a level per factor. */
export function evaluate(
  se: Series,
  date: string,
  startMin: number,
  durMin: number,
  pace: number,
  s: Settings,
): Evaluation | null {
  const f0 = fIdx(se, date, startMin);
  const f1 = fIdx(se, date, startMin + durMin);
  if (f0 == null || f1 == null || f1 < f0) return null;
  const v: { T: number; app: number; ws: number; wg: number; pp: number; code: number; feel: number }[] = [];
  for (let f = f0; f <= f1 + 1e-6; f += 0.25) {
    const T = at(se.T, f);
    const ws = at(se.ws, f);
    if (T == null || ws == null) return null;
    const app = at(se.app, f) ?? T;
    v.push({
      T,
      app,
      ws,
      wg: at(se.wg, f) ?? ws,
      pp: near(se.pp, f) ?? 0,
      code: near(se.code, f) ?? 0,
      feel: bikeFeel(T, ws, app, pace),
    });
  }
  let rain = 0;
  for (let i = Math.floor(f0) + 1; i <= Math.ceil(f1); i++) rain += se.p[i] ?? 0;
  const mx = (k: keyof (typeof v)[number]) => Math.max(...v.map((x) => x[k]));
  const mn = (k: keyof (typeof v)[number]) => Math.min(...v.map((x) => x[k]));
  const first = v[0];
  const last = v[v.length - 1];
  if (!first || !last) return null;
  const road = roadAt(se, f0, s);
  const st: WindowStats = {
    tMin: mn("T"),
    tMax: mx("T"),
    appMin: mn("app"),
    appMax: mx("app"),
    feelMin: mn("feel"),
    feelMax: mx("feel"),
    wsMax: mx("ws"),
    wgMax: mx("wg"),
    ppMax: mx("pp"),
    rain,
    dir: near(se.wd, f0) ?? 0,
    road,
    roadEnd: roadAt(se, f1, s),
    thunder: v.some((x) => x.code >= 95),
    warms: last.feel > first.feel,
  };
  const factors: Evaluation["factors"] = [
    { k: "Road", level: road.level },
    { k: "Cold", level: lvl3(st.feelMin, s.feelCaution, s.feelNoGo, false) },
    { k: "Heat", level: lvl3(st.appMax, s.heatCaution, s.heatNoGo) },
    {
      k: "Wind",
      level: Math.max(lvl3(st.wsMax, s.windCaution, s.windNoGo), lvl3(st.wgMax, s.gustCaution, s.gustNoGo)) as Level,
    },
    {
      k: "Rain",
      level: st.thunder
        ? 2
        : (Math.max(
            lvl3(st.ppMax, s.rainProbCaution, s.rainProbNoGo),
            lvl3(rain, s.rainAmtCaution, s.rainAmtNoGo),
          ) as Level),
    },
  ];
  return { st, factors, f0, f1 };
}

/** An active NWS alert at the spot (from /api/alerts). */
export interface Alert {
  event: string; // e.g. "Wind Advisory"
  headline: string;
  level: 1 | 2; // warning = red, advisory or watch = amber
}

export interface Warning {
  level: 1 | 2;
  short: string; // chip text
  title: string;
  detail: string;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (deg: number): string => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] ?? "N";
export const fmtIn = (v: number): string => `${v < 0.005 ? "0" : v < 0.1 ? v.toFixed(2) : v.toFixed(1)}"`;
const r0 = Math.round;

/** Only conditions that need attention, most severe first. Shared by the ride page and Plan's spot list. */
export function warnings(
  ev: Evaluation,
  se: Series,
  date: string,
  startMin: number,
  s: Settings,
  alerts: Alert[] = [],
): Warning[] {
  const st = ev.st;
  const out: Warning[] = alerts.map((a) => ({ level: a.level, short: a.event, title: a.event, detail: a.headline }));
  const sunrise = se.sunrise.get(date);
  if (sunrise != null && startMin < sunrise + LOW_LIGHT_MIN) {
    out.push({
      level: 1,
      short: "Low light",
      title: "Low light at roll-out",
      detail: `Sunrise ${fmtTime(sunrise)}; bring front and rear lights`,
    });
  }
  for (const f of ev.factors) {
    if (!f.level) continue;
    const l = f.level;
    if (f.k === "Road") {
      const later = st.roadEnd.state !== st.road.state ? `; ${st.roadEnd.state.toLowerCase()} by the finish` : "";
      out.push({
        level: l,
        short: `Roads ${st.road.state.toLowerCase()}`,
        title: `Roads ${st.road.state.toLowerCase()} at roll-out`,
        detail: `${fmtIn(st.road.rainIn)} of rain in the last ${s.lookback} h${later}`,
      });
    } else if (f.k === "Cold") {
      out.push({
        level: l,
        short: `Cold ${r0(st.feelMin)}°`,
        title: `Cold: bike feel down to ${r0(st.feelMin)}°`,
        detail: "Dress for the start; see What to wear",
      });
    } else if (f.k === "Heat") {
      out.push({
        level: l,
        short: `Hot ${r0(st.appMax)}°`,
        title: `Hot: real feel up to ${r0(st.appMax)}°`,
        detail: "Bring extra water",
      });
    } else if (f.k === "Wind") {
      out.push({
        level: l,
        short: `Wind ${r0(st.wsMax)}/${r0(st.wgMax)}`,
        title: `Windy: ${r0(st.wsMax)} mph, gusts ${r0(st.wgMax)}`,
        detail: `From the ${compass(st.dir)}`,
      });
    } else if (st.thunder) {
      out.push({ level: 2, short: "Thunder", title: "Thunderstorms possible", detail: `${fmtIn(st.rain)} expected` });
    } else {
      out.push({
        level: l,
        short: `Rain ${r0(st.ppMax)}%`,
        title: `Rain: ${r0(st.ppMax)}% chance`,
        detail: `${fmtIn(st.rain)} expected during the ride`,
      });
    }
  }
  return out.sort((a, b) => b.level - a.level);
}
