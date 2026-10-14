import { describe, expect, it } from "vitest";
import fallback from "../data/raw/om_purchase.json";
import seed from "../data/seed.json";
import { activityInput, activityUpdate, contactFields } from "../shared/api.ts";
import { fold, icsCalendar } from "../shared/ics.ts";
import { DEFAULT_KIT, kitAdvice, kitBand } from "../shared/kit.ts";
import {
  cleanName,
  encodeMentions,
  fmtPhone,
  mentionIds,
  normalizePhone,
  plainMentions,
  splitMentions,
} from "../shared/people.ts";
import { parseLatLng, type Route, rideTimes } from "../shared/ride.ts";
import { DEFAULT_SETTINGS as S, settingsProblem } from "../shared/settings.ts";
import { activityIcon, ICON_KEYS, SPORT_ICON } from "../shared/sport-icons.ts";
import { minPerMile, mphFromMinPerMile, rulesFor, SPORTS } from "../shared/sports.ts";
import { fmtDur, fmtTime, isDate, nextWeekendDays, nyToUTC, weekendDates } from "../shared/time.ts";
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
import { ICON_PATHS } from "../src/lib/icon-paths.ts";
import { splitLinks } from "../src/lib/links.ts";

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

const RIDE = rulesFor("ride", 17, S.warn);
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
    const ev = evaluate(base, "2026-10-10", 8 * 60, 180, RIDE, S);
    expect(ev?.st.warms).toBe(true);
    expect(kitAdvice(must(ev).st, DEFAULT_KIT, "avg", S).shed?.to.name).toBeDefined();
    const cooling = series(24, { T: Array.from({ length: 24 }, (_, i) => 80 - i * 2) });
    const ev2 = evaluate(cooling, "2026-10-10", 8 * 60, 180, RIDE, S);
    expect(kitAdvice(must(ev2).st, DEFAULT_KIT, "avg", S).shed).toBeNull();
  });
});

describe("warnings", () => {
  it("shows nothing for a clean forecast and thunder replaces rain", () => {
    const clean = series(24);
    const ev = must(evaluate(clean, "2026-10-10", 9 * 60, 180, RIDE, S));
    expect(warnings(ev, clean, "2026-10-10", 9 * 60, RIDE)).toEqual([]);
    const storm = series(24, { code: Array(24).fill(95), pp: Array(24).fill(40) });
    const w = warnings(must(evaluate(storm, "2026-10-10", 9 * 60, 180, RIDE, S)), storm, "2026-10-10", 9 * 60, RIDE);
    expect(w.map((x) => x.kind)).toEqual(["thunder"]);
  });
  it("evaluates the saved Open-Meteo sample", () => {
    const se = toSeries(fallback as unknown as OpenMeteoResponse);
    const ev = evaluate(se, "2026-10-10", 8 * 60 + 30, 191, RIDE, S);
    expect(ev).not.toBeNull();
    expect(ev?.factors).toHaveLength(5);
    expect(se.sunrise.get("2026-10-10")).toBeGreaterThan(6 * 60);
  });
});

describe("time", () => {
  it("matches the time zone database every half hour for five years", () => {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2031, 0, 1); t += 1_800_000) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      const date = `${p.year}-${p.month}-${p.day}`;
      const min = Number(p.hour) * 60 + Number(p.minute);
      const back = nyToUTC(date, min).getTime();
      // The repeated hour in November maps to its first (daylight) occurrence.
      expect(back === t || back === t - 3_600_000).toBe(true);
    }
  });
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

describe("settings checks", () => {
  it("accepts the defaults", () => expect(settingsProblem(S)).toBeNull());
  it("needs red beyond amber", () => {
    const run = S.warn.run;
    expect(settingsProblem({ ...S, warn: { ...S.warn, run: { ...run, feelNoGo: run.feelCaution } } })).toMatch(
      /Run weather, cold/,
    );
    const ski = S.warn.ski;
    expect(settingsProblem({ ...S, warn: { ...S.warn, ski: { ...ski, heatNoGo: ski.heatCaution } } })).toMatch(/heat/);
    expect(settingsProblem({ ...S, dryingMm: S.wetMm })).not.toBeNull();
  });
});

describe(".ics line folding", () => {
  it("keeps short lines", () => expect(fold("SUMMARY:Ride")).toBe("SUMMARY:Ride"));
  it("folds long ASCII lines at 75 bytes", () => {
    const lines = fold(`DESCRIPTION:${"x".repeat(200)}`).split("\r\n");
    expect(lines.map((l) => l.length)).toEqual([75, 75, 64]);
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(`DESCRIPTION:${"x".repeat(200)}`);
  });
  it("folds at 75 bytes without splitting a character", () => {
    const lines = fold(`DESCRIPTION:${"é".repeat(60)}`).split("\r\n");
    expect(lines.length).toBe(2);
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(lines[1]?.startsWith(" ")).toBe(true);
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(`DESCRIPTION:${"é".repeat(60)}`);
  });
});

describe(".ics calendar", () => {
  const ev = {
    id: "abc",
    date: "2026-10-17",
    start: 510,
    end: 630,
    title: "BBT ride: River loop",
    location: "40.7, -74",
    geo: { lat: 40.7, lng: -74 },
    details: "Line one\r\nLine; two, three",
  };
  it("writes one event with a stable UID and UTC times", () => {
    const ics = icsCalendar([ev]);
    expect(ics).toContain("UID:abc-once@app.bbt.team");
    expect(ics).toContain("DTSTART:20261017T123000Z"); // 8:30 New York, daylight time
    expect(ics).toContain("DESCRIPTION:Line one\\nLine\\; two\\, three");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).not.toContain("X-WR-CALNAME");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("builds a full feed (100 long events) quickly: the Worker has about 10 ms of CPU", () => {
    const events = Array.from({ length: 100 }, (_, i) => ({ ...ev, id: `a${i}`, details: "é—x ".repeat(200) }));
    icsCalendar(events, true); // warm up
    const t = performance.now();
    const ics = icsCalendar(events, true);
    expect(performance.now() - t).toBeLessThan(25); // was ~45 ms before fold() stopped encoding per character
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it("marks a cancelled activity and names the feed", () => {
    const ics = icsCalendar([{ ...ev, cancelled: true, updatedAt: "2026-10-15T10:00:00.000Z" }], true);
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SUMMARY:Cancelled: BBT ride: River loop");
    expect(ics).toContain("X-WR-CALNAME:BBT");
    expect(ics).toContain("UID:abc@app.bbt.team");
    expect(icsCalendar([], true)).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("LAST-MODIFIED:20261015T100000Z");
    expect(ics).toContain(`SEQUENCE:${Date.parse("2026-10-15T10:00:00.000Z") / 1000}`);
  });
});

describe("sports", () => {
  it("applies each sport's rules", () => {
    expect(rulesFor("ride", 17, S.warn)).toMatchObject({ pace: 17, road: true, lowLight: true, warn: S.warn.ride });
    expect(rulesFor("run", 6.5, S.warn)).toMatchObject({ pace: 6.5, road: false, lowLight: true, warn: S.warn.run });
    expect(rulesFor("swim", 17, S.warn)).toMatchObject({ pace: 0, road: false, lowLight: false, warn: S.warn.outdoor });
  });
  it("converts run pace", () => {
    expect(minPerMile(3600 / 540)).toBe("9:00");
    expect(mphFromMinPerMile("8:00")).toBe(7.5);
    expect(mphFromMinPerMile("8")).toBe(7.5);
    expect(mphFromMinPerMile("7.5")).toBe(8);
    expect(mphFromMinPerMile("8:75")).toBeNull();
  });
  it("leaves out road warnings except for rides", () => {
    const wet = series(24, { p: Array(24).fill(0.05) });
    const ride = must(evaluate(wet, "2026-10-10", 9 * 60, 120, RIDE, S));
    const run = must(evaluate(wet, "2026-10-10", 9 * 60, 120, rulesFor("run", 6.5, S.warn), S));
    expect(ride.factors.find((f) => f.k === "Road")?.level).toBe(2);
    expect(run.factors.find((f) => f.k === "Road")?.level).toBe(0);
  });
});

describe("activity input", () => {
  const ride = {
    sport: "ride",
    date: "2026-10-17",
    startTime: "08:30",
    spotId: "suny-purchase",
    pace: 17,
    notes: "",
    routes: [{ label: "Main", routeId: 57406828, stop: null }],
  } as const;
  const swim = {
    ...ride,
    sport: "swim",
    pace: 0,
    routes: [],
    endTime: "07:00",
    startTime: "06:00",
    outdoor: false,
  } as const;
  it("needs a route and an in-range pace for ride and run", () => {
    expect(activityInput.safeParse(ride).success).toBe(true);
    expect(activityInput.safeParse({ ...ride, routes: [] }).success).toBe(false);
    expect(activityInput.safeParse({ ...ride, pace: 30 }).success).toBe(false);
    expect(activityInput.safeParse({ ...ride, sport: "run", pace: 17 }).success).toBe(false); // runs: 4–12 mph
  });
  it("needs an end after the start and no route for other sports", () => {
    expect(activityInput.safeParse(swim).success).toBe(true);
    expect(activityInput.safeParse({ ...swim, endTime: "06:00" }).success).toBe(false);
    expect(activityInput.safeParse({ ...swim, endTime: null }).success).toBe(false);
    expect(activityInput.safeParse({ ...swim, routes: ride.routes }).success).toBe(false);
  });
  it("stores fields that don't apply as empty", () => {
    const r = activityInput.parse({ ...ride, endTime: "11:00", outdoor: false, details: "2 courts" });
    expect(r).toMatchObject({ endTime: null, outdoor: true, details: "" });
    expect(activityInput.parse({ ...swim, pace: 5 }).pace).toBe(0);
    expect(activityInput.parse({ ...swim, sport: "ski", outdoor: false }).outdoor).toBe(true);
  });
  it("keeps a picked icon only on Other activities", () => {
    expect(activityInput.parse({ ...swim, sport: "other", icon: "hiking" }).icon).toBe("hiking");
    expect(activityInput.parse({ ...swim, sport: "other", icon: "pending" }).icon).toBeNull(); // the default
    expect(activityInput.parse({ ...swim, icon: "hiking" }).icon).toBeNull();
    expect(activityInput.parse(swim).icon).toBeNull();
    expect(activityInput.safeParse({ ...swim, sport: "other", icon: "rocket" }).success).toBe(false);
  });
  it("has a shape for every icon and an icon for every sport", () => {
    for (const k of ICON_KEYS) expect(ICON_PATHS[k]).toMatch(/^[Mm][\d.-]/);
    expect(Object.keys(ICON_PATHS).toSorted()).toEqual([...ICON_KEYS].toSorted());
    for (const s of SPORTS) expect(ICON_KEYS).toContain(SPORT_ICON[s]);
    expect(activityIcon({ sport: "other", icon: "kayaking" })).toBe("kayaking");
    expect(activityIcon({ sport: "ride", icon: "kayaking" })).toBe("directions_bike");
    expect(activityIcon({ sport: "other", icon: null })).toBe("pending");
  });
  it("needs the base version on an update", () => {
    expect(activityUpdate.safeParse(ride).success).toBe(false);
    expect(activityUpdate.safeParse({ ...ride, baseUpdatedAt: "2026-10-13T00:00:00Z" }).success).toBe(true);
  });
});

describe("links in notes and messages", () => {
  it("makes http, https and www links tappable and leaves punctuation outside", () => {
    expect(splitLinks("Hotel: https://example.com/a?b=1. See you")).toEqual([
      { text: "Hotel: " },
      { text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { text: ". See you" },
    ]);
    expect(splitLinks("(www.bbt.team)")).toEqual([
      { text: "(" },
      { text: "www.bbt.team", href: "https://www.bbt.team" },
      { text: ")" },
    ]);
    expect(splitLinks("https://en.wikipedia.org/wiki/Bike_(disambiguation)")[0]).toMatchObject({
      href: "https://en.wikipedia.org/wiki/Bike_(disambiguation)",
    });
  });
  it("links nothing else", () => {
    expect(splitLinks("javascript:alert(1) ftp://x mailto:a@b.c")).toEqual([
      { text: "javascript:alert(1) ftp://x mailto:a@b.c" },
    ]);
  });
});

describe("quick-pick dates", () => {
  it("lists the next four weekend days, today included on a weekend", () => {
    expect(nextWeekendDays("2026-10-14")).toEqual(["2026-10-17", "2026-10-18", "2026-10-24", "2026-10-25"]);
    expect(nextWeekendDays("2026-10-18")).toEqual(["2026-10-18", "2026-10-24", "2026-10-25", "2026-10-31"]);
  });
});

describe("phones", () => {
  it("normalizes US numbers typed any common way, and international ones with +", () => {
    for (const v of [
      "(914) 555-0142",
      "914-555-0142",
      "914.555.0142",
      "9145550142",
      "1 914 555 0142",
      "+1 914 555 0142",
    ])
      expect(normalizePhone(v)).toBe("+19145550142");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    for (const v of ["", "555-0142", "call me", "+12", "914 555 0142 ext 3", "12345678901234567"])
      expect(normalizePhone(v)).toBeNull();
  });
  it("formats US numbers for people and leaves others as stored", () => {
    expect(fmtPhone("+19145550142")).toBe("(914) 555-0142");
    expect(fmtPhone("+442079460958")).toBe("+442079460958");
  });
  it("requires a phone, and both or neither of the emergency name and phone", () => {
    expect(contactFields.parse({ phone: "914 555 0142" })).toEqual({
      phone: "+19145550142",
      emergencyName: null,
      emergencyPhone: null,
    });
    const both = { phone: "9145550142", emergencyName: " Chris Park ", emergencyPhone: "(914) 555-0190" };
    expect(contactFields.parse(both)).toEqual({
      phone: "+19145550142",
      emergencyName: "Chris Park",
      emergencyPhone: "+19145550190",
    });
    expect(contactFields.parse(contactFields.parse(both))).toEqual(contactFields.parse(both)); // output re-validates
    expect(contactFields.safeParse({ phone: "" }).success).toBe(false);
    expect(contactFields.safeParse({ phone: "9145550142", emergencyName: "Chris" }).success).toBe(false);
    expect(contactFields.safeParse({ phone: "9145550142", emergencyPhone: "9145550190" }).success).toBe(false);
    expect(contactFields.safeParse({ phone: "9145550142", emergencyName: "C", emergencyPhone: "x" }).success).toBe(
      false,
    );
  });
});

describe("mentions", () => {
  const team = [
    { id: "u1", name: "Jo Park" },
    { id: "u2", name: "Jo" },
  ];
  it("stores picked names as tokens, longer names first", () => {
    const body = encodeMentions("Thanks @Jo Park and @Jo! @Sam stays text", team);
    expect(body).toBe("Thanks <@u1> and <@u2>! @Sam stays text");
    expect(mentionIds(`${body} <@u1>`)).toEqual(["u1", "u2"]);
  });
  it("never matches inside a longer name, and copes with names that look like patterns", () => {
    expect(encodeMentions("@Jo Parker", [{ id: "u1", name: "Jo Park" }])).toBe("@Jo Parker");
    expect(encodeMentions("@Joanna, @Jo.", team)).toBe("@Joanna, <@u2>.");
    expect(encodeMentions("hi @A.B (x)", [{ id: "u3", name: "A.B (x)" }])).toBe("hi <@u3>");
  });
  it("cleans names: invisible and direction-changing characters out, spaces collapsed", () => {
    expect(cleanName("  Jo\u202E kraP \u200B  Park\n")).toBe("Jo kraP Park");
  });
  it("shows tokens as names, and unknown people as a former member", () => {
    const names = new Map(team.map((t) => [t.id, t.name]));
    expect(plainMentions("Hi <@u1>, <@gone>", (id) => names.get(id))).toBe("Hi @Jo Park, @Former member");
    expect(splitMentions("a <@u1> b")).toEqual([{ text: "a " }, { mention: "u1" }, { text: " b" }]);
    expect(splitMentions("<@u1>")).toEqual([{ mention: "u1" }]);
    expect(splitMentions("no mentions <@ bad>")).toEqual([{ text: "no mentions <@ bad>" }]);
  });
});
