// All ride times are America/New_York wall-clock: a date "YYYY-MM-DD" plus minutes after midnight.
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

/** UTC instant of a New York wall-clock time (DST-aware): start from UTC, correct by the observed offset. */
export function nyToUTC(date: string, min: number): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const want = Date.UTC(y, m - 1, d, 0, Math.round(min));
  let t = want;
  for (let i = 0; i < 2; i++) {
    const p = nyParts(new Date(t));
    const [py, pm, pd] = p.date.split("-").map(Number) as [number, number, number];
    t += want - Date.UTC(py, pm - 1, pd, 0, p.min);
  }
  return new Date(t);
}

export const pad = (n: number): string => String(n).padStart(2, "0");

export function addDays(date: string, n: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

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
