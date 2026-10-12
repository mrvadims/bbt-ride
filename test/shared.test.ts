import { describe, expect, it } from "vitest";
import fallback from "../data/raw/om_purchase.json";
import seed from "../data/seed.json";
import { DEFAULT_KIT, kitAdvice, kitBand } from "../shared/kit.ts";
import { parseLatLng, type Route, rideTimes } from "../shared/ride.ts";
import { DEFAULT_SETTINGS as S } from "../shared/settings.ts";
import { fmtDur, fmtTime, isDate, nyToUTC, weekendDates } from "../shared/time.ts";
import {
  bikeFeel,
  dryingRate,
  evaluate,
  fIdx,
  type OpenMeteoResponse,
  roadAt,
  type Series,
  toSeries,
  warnings,
  windChill,
} from "../shared/weather.ts";

/** Fails the test when a value is unexpectedly missing. */
function must<T>(v: T | null | undefined): T {
  if (v == null) throw new Error("expected a value");
  return v;
}

/** A synthetic series of `n` hours starting at 2026-10-10T00:00 with constant weather, overridable per column. */
type Column = Exclude<keyof Series, "time" | "idx" | "sunrise">;
function series(n: number, over: Partial<Record<Column, (number | null)[]>> = {}): Series {
  const time = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 10, i));
    return `${d.toISOString().slice(0, 13)}:00`;
  });
  const col = (v: number) => Array(n).fill(v);
  const hourly = {
    time,
    temperature_2m: col(60),
    apparent_temperature: col(60),
    precipitation: col(0),
    precipitation_probability: col(0),
    weather_code: col(1),
    cloud_cover: col(50),
    wind_speed_10m: col(5),
    wind_direction_10m: col(270),
    wind_gusts_10m: col(10),
    dew_point_2m: col(45),
    shortwave_radiation: col(300),
    is_day: col(1),
  };
  return { ...toSeries({ hourly } as OpenMeteoResponse), ...over };
}

describe("bike feel (DESIGN.md examples)", () => {
  it("uses airflow √(pace² + wind²)", () => {
    expect(Math.sqrt(17 ** 2 + 10 ** 2)).toBeCloseTo(19.72, 2);
  });
  it("matches the worked examples at 17 mph pace, 5 mph wind", () => {
    expect(Math.round(bikeFeel(40, 5, null, 17))).toBe(31);
    expect(Math.round(bikeFeel(50, 5, null, 17))).toBe(44);
    expect(Math.round(bikeFeel(60, 5, null, 17))).toBe(57);
    expect(bikeFeel(75, 5, 77, 17)).toBe(77);
  });
  it("has a ≈ −6 °F chill delta at 50 °F and 20 mph airflow", () => {
    expect(windChill(50, 20) - 50).toBeCloseTo(-6.4, 1);
  });
});

describe("road wetness", () => {
  it("matches the drying anchors", () => {
    const sunny = series(1, { T: [68], dew: [54], ws: [8], sw: [600] });
    expect(dryingRate(sunny, 0)).toBeCloseTo(0.715, 2);
    const night = series(1, { T: [46], dew: [43], ws: [0], sw: [0], day: [0], cloud: [100] });
    expect(dryingRate(night, 0)).toBeCloseTo(0.076, 2);
  });
  it("goes Wet → Drying → Dry after rain", () => {
    const p = Array(24).fill(0);
    p[2] = 0.1; // 2.5 mm, capped at 2 mm of film
    const se = series(24, { p });
    expect(roadAt(se, 2, S).state).toBe("Wet"); // raining this hour
    expect(roadAt(se, 3, S).state).toBe("Wet");
    const states = Array.from({ length: 12 }, (_, i) => roadAt(se, 3 + i, S).state);
    expect(states).toContain("Drying");
    expect(roadAt(se, 13, S)).toMatchObject({ state: "Dry", rained: true }); // rain still inside the 12 h look-back
    expect(roadAt(se, 23, S)).toMatchObject({ state: "Dry", rained: false });
  });
});

describe("ETA math (DESIGN.md example: SUNY Katonah 46, 17 mph, Tazza)", () => {
  const route = seed.routes.find((r) => r.id === 57406828) as unknown as Route;
  const t = rideTimes(route, "08:30", 17, "Tazza Cafe", S);
  it("computes moving time, stop ETA and the ride window", () => {
    expect(fmtDur(t.movingH)).toBe("2h 43m");
    expect(t.stop?.mile).toBeCloseTo(24.4, 1);
    expect(fmtTime(t.stop?.eta ?? 0)).toBe("10:00 AM");
    expect(fmtTime(t.end)).toBe("11:41 AM");
  });
  it("gives pure moving time with a 0 % buffer and no stop", () => {
    const t0 = rideTimes(route, "08:30", 17, null, { ...S, regroupPct: 0 });
    expect(t0.end - t0.start).toBeCloseTo(t0.movingH * 60, 6);
  });
});

describe("kit chart", () => {
  it("picks bands by bike feel", () => {
    expect(kitBand(DEFAULT_KIT, 70).name).toBe("Summer");
    expect(kitBand(DEFAULT_KIT, 69.9).name).toBe("Mild");
    expect(kitBand(DEFAULT_KIT, 30).name).toBe("Very cold");
    expect(kitBand(DEFAULT_KIT, 29.9).name).toBe("Deep winter");
  });
  it("adds a shedding hint only when it warms up", () => {
    const rising = Array.from({ length: 24 }, (_, i) => 20 + i * 4);
    const base = series(24, { T: rising, app: rising });
    const ev = evaluate(base, "2026-10-10", 8 * 60, 180, 17, S);
    expect(ev?.st.warms).toBe(true);
    expect(kitAdvice(must(ev).st, DEFAULT_KIT, "avg", S).shed?.to.name).toBeDefined();
    const cooling = series(24, { T: Array.from({ length: 24 }, (_, i) => 80 - i * 2) });
    const ev2 = evaluate(cooling, "2026-10-10", 8 * 60, 180, 17, S);
    expect(kitAdvice(must(ev2).st, DEFAULT_KIT, "avg", S).shed).toBeNull();
  });
});

describe("warnings", () => {
  it("shows nothing for a clean forecast and thunder replaces rain", () => {
    const clean = series(24);
    const ev = must(evaluate(clean, "2026-10-10", 9 * 60, 180, 17, S));
    expect(warnings(ev, clean, "2026-10-10", 9 * 60)).toEqual([]);
    const storm = series(24, { code: Array(24).fill(95), pp: Array(24).fill(40) });
    const w = warnings(must(evaluate(storm, "2026-10-10", 9 * 60, 180, 17, S)), storm, "2026-10-10", 9 * 60);
    expect(w.map((x) => x.kind)).toEqual(["thunder"]);
  });
  it("evaluates the saved Open-Meteo sample", () => {
    const se = toSeries(fallback as unknown as OpenMeteoResponse);
    const ev = evaluate(se, "2026-10-10", 8 * 60 + 30, 191, 17, S);
    expect(ev).not.toBeNull();
    expect(ev?.factors).toHaveLength(5);
    expect(se.sunrise.get("2026-10-10")).toBeGreaterThan(6 * 60);
  });
});

describe("time", () => {
  it("converts New York wall-clock to UTC across DST", () => {
    expect(nyToUTC("2026-10-10", 510).toISOString()).toBe("2026-10-10T12:30:00.000Z");
    expect(nyToUTC("2026-12-12", 510).toISOString()).toBe("2026-12-12T13:30:00.000Z");
  });
  it("finds this weekend", () => {
    expect(weekendDates("2026-10-10")).toEqual(["2026-10-10", "2026-10-11"]);
    expect(weekendDates("2026-10-11")).toEqual(["2026-10-11", "2026-10-17"]);
    expect(weekendDates("2026-10-14")).toEqual(["2026-10-17", "2026-10-18"]);
  });
  it("looks up hours by label on a 25-hour DST day", () => {
    const time = ["2026-11-01T00:00", "2026-11-01T01:00", "2026-11-01T01:00"];
    for (let h = 2; h < 24; h++) time.push(`2026-11-01T${String(h).padStart(2, "0")}:00`);
    const se = { ...series(1), time, idx: new Map(time.map((t, i) => [t, i])) };
    expect(fIdx(se, "2026-11-01", 8 * 60)).toBe(time.indexOf("2026-11-01T08:00"));
    expect(fIdx(se, "2026-11-01", Number.NaN)).toBeNull();
  });
});

describe("Google Maps links", () => {
  it("prefers the pin, then query, then map centre", () => {
    expect(
      parseLatLng("https://www.google.com/maps/place/X/@41.04,-73.70,15z/data=!3m1!4b1!8m2!3d41.0454!4d-73.6973"),
    ).toEqual({
      lat: 41.0454,
      lng: -73.6973,
    });
    expect(parseLatLng("https://maps.google.com/?q=41.1,-73.7")).toEqual({ lat: 41.1, lng: -73.7 });
    expect(parseLatLng("https://www.google.com/maps/search/41.2,+-73.8")).toEqual({ lat: 41.2, lng: -73.8 });
    expect(parseLatLng("https://www.google.com/maps/@41.3,-73.9,14z")).toEqual({ lat: 41.3, lng: -73.9 });
    expect(parseLatLng("41.0454, -73.6973")).toEqual({ lat: 41.0454, lng: -73.6973 });
    expect(parseLatLng("nonsense")).toBeNull();
    expect(parseLatLng("91.0, 10.0")).toBeNull();
  });
});

describe("dates from URLs", () => {
  it("accepts real calendar dates only", () => {
    expect([isDate("2026-10-17"), isDate("2028-02-29")]).toEqual([true, true]);
    expect([isDate("2026-02-31"), isDate("2026-13-01"), isDate("17/10/2026"), isDate(null)]).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
