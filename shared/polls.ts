// Date polls (DESIGN.md → Date polls): the rules both sides share. An option is one day or a block of 2–4 days; a poll
// has up to 14 of them, all from today to a year ahead.
import { addDays, dow } from "./time.ts";

export const POLL_OPTIONS_MAX = 14;
export const POLL_BLOCK_DAYS_MAX = 4;
export const POLL_AHEAD_DAYS = 365;

export interface PollDates {
  startsOn: string; // YYYY-MM-DD
  endsOn: string; // the same day for a single day
}

const DAY_MS = 864e5;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** How many days the option covers (1 for a single day). */
export const daysIn = (o: PollDates): number => Math.round((utc(o.endsOn) - utc(o.startsOn)) / DAY_MS) + 1;

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (d: string) => MONTH[Number(d.slice(5, 7)) - 1];
const day = (d: string) => Number(d.slice(8, 10));

/** "Sat, Oct 24", or for a block "Sat–Sun, Oct 24–25" / "Fri–Sun, Oct 30–Nov 1". */
export function optionLabel(o: PollDates): string {
  const a = o.startsOn;
  const b = o.endsOn;
  if (a === b) return `${WEEKDAY[dow(a)]}, ${month(a)} ${day(a)}`;
  const span =
    month(a) === month(b) ? `${month(a)} ${day(a)}–${day(b)}` : `${month(a)} ${day(a)}–${month(b)} ${day(b)}`;
  return `${WEEKDAY[dow(a)]}–${WEEKDAY[dow(b)]}, ${span}`;
}

/** What's wrong with a poll's options, or null when they're fine. */
export function optionsProblem(options: PollDates[], today: string): string | null {
  if (!options.length) return "Pick at least one date";
  if (options.length > POLL_OPTIONS_MAX) return `Pick at most ${POLL_OPTIONS_MAX} options`;
  const last = addDays(today, POLL_AHEAD_DAYS);
  for (const o of options) {
    if (o.endsOn < o.startsOn) return "An option ends before it starts";
    if (o.startsOn < today) return "Pick today or later dates";
    if (o.endsOn > last) return "Pick dates within the next 12 months";
    if (daysIn(o) > POLL_BLOCK_DAYS_MAX) return `A block is at most ${POLL_BLOCK_DAYS_MAX} days`;
  }
  const sorted = byDate(options);
  if (sorted.some((o, i) => i > 0 && overlaps(o, sorted[i - 1] as PollDates))) return "Two options share a day";
  return null;
}

/** Whether two options share at least one day. */
export const overlaps = (a: PollDates, b: PollDates): boolean => a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;

/** Options in date order. */
export const byDate = <T extends PollDates>(options: T[]): T[] =>
  [...options].sort((x, y) => x.startsOn.localeCompare(y.startsOn) || x.endsOn.localeCompare(y.endsOn));

/** Answers close the day before the first option, but never before today. */
export function defaultCloses(options: PollDates[], today: string): string {
  const first = byDate(options)[0];
  if (!first) return today;
  const before = addDays(first.startsOn, -1);
  return before < today ? today : before;
}

/** The latest a poll can take answers: the last day of its last option. */
export const lastDay = (options: PollDates[]): string =>
  options.reduce((m, o) => (o.endsOn > m ? o.endsOn : m), options[0]?.endsOn ?? "");

/** Best first: the most In, then the most Maybe, then the earliest. */
export function ranked<T extends PollDates & { inCount: number; maybeCount: number }>(options: T[]): T[] {
  return [...options].sort(
    (x, y) => y.inCount - x.inCount || y.maybeCount - x.maybeCount || x.startsOn.localeCompare(y.startsOn),
  );
}

/** The next Saturday–Sunday that shares no day with an option already picked (today's weekend when its Saturday is
 * today or later). */
export function nextWeekend(today: string, taken: PollDates[]): PollDates | null {
  const last = addDays(today, POLL_AHEAD_DAYS);
  for (let sat = addDays(today, (6 - dow(today) + 7) % 7); sat <= last; sat = addDays(sat, 7)) {
    const o = { startsOn: sat, endsOn: addDays(sat, 1) };
    if (o.endsOn <= last && !taken.some((t) => overlaps(t, o))) return o;
  }
  return null;
}
