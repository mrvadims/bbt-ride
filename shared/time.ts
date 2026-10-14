// All activity times are America/New_York wall-clock: a date "YYYY-MM-DD" plus minutes after midnight.
import { z } from "zod";

export const TZ = "America/New_York";

const NY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

interface WallTime {
  date: string;
  min: number;
}

function nyParts(t: Date): WallTime {
  const p = Object.fromEntries(NY_FMT.formatToParts(t).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

export const nyNow = (): WallTime => nyParts(new Date());

// US Eastern daylight time (UTC−4) runs from the second Sunday of March to the first Sunday of November, 02:00 local;
// otherwise standard time (UTC−5). Plain arithmetic: Intl takes ~16 µs a call, too slow for a 100-event calendar feed.
const sunday = (y: number, month: number, nth: number) =>
  1 + ((7 - new Date(Date.UTC(y, month, 1)).getUTCDay()) % 7) + 7 * (nth - 1);

/** UTC instant of a New York wall-clock time (DST-aware; the repeated 1–2 AM in November counts as daylight time). */
export function nyToUTC(date: string, min: number): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 0, Math.round(min)); // the wall-clock reading, as if it were UTC
  const dst = wall >= Date.UTC(y, 2, sunday(y, 2, 2), 2) && wall < Date.UTC(y, 10, sunday(y, 10, 1), 2);
  return new Date(wall + (dst ? 4 : 5) * 3_600_000);
}

export const pad = (n: number): string => String(n).padStart(2, "0");

export function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** A real calendar date in YYYY-MM-DD form (e.g. from a URL; rejects 2026-02-31). */
export const isDate = (v: string | null | undefined): v is string => z.iso.date().safeParse(v).success;

/** Day of week, 0 = Sunday. */

export const dow = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

export const hhmmToMin = (s: string): number => {
  const [h, m] = s.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** A moment as "Sat 9:12 PM" in New York time (message and update stamps). */
export const fmtStamp = (iso: string): string =>
  new Date(iso).toLocaleString("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" });

export function fmtTime(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? "AM" : "PM"}`;
}

export function fmtDur(hours: number): string {
  const m = Math.round(hours * 60);
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

export function dayLabel(date: string, long = false): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: long ? "long" : "short",
    month: "short",
    day: "numeric",
  });
}

/** This weekend's Saturday and Sunday (on a Sunday: today and next Saturday), sorted. */
export function weekendDates(today: string): [string, string] {
  const w = dow(today);
  const sat = addDays(today, (6 - w + 7) % 7);
  const sun = w === 0 ? today : addDays(sat, 1);
  return sat < sun ? [sat, sun] : [sun, sat];
}

export const isWeekend = (date: string): boolean => dow(date) === 0 || dow(date) === 6;

/** The next `n` weekend days from today (today included when it's a Saturday or Sunday): Plan's quick-pick dates. */
export function nextWeekendDays(today: string, n = 4): string[] {
  const out: string[] = [];
  for (let d = today; out.length < n; d = addDays(d, 1)) if (isWeekend(d)) out.push(d);
  return out;
}
