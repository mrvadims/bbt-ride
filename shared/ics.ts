// iCalendar (.ics) text for one activity (the Calendar tile) or a person's whole feed (the calendar link), RFC 5545.
import { nyToUTC } from "./time.ts";

export interface CalEvent {
  id: string; // activity id: the event's UID, so a re-added or re-polled activity updates instead of duplicating
  date: string;
  start: number; // minutes after midnight, New York
  end: number;
  title: string;
  location: string;
  geo: { lat: number; lng: number };
  details: string;
  url?: string;
  cancelled?: boolean;
  updatedAt?: string; // ISO; becomes SEQUENCE and LAST-MODIFIED so calendars apply changes
}

/** The activity as a calendar event: start → end, at the place's pin, with routes, details and notes. */
export function activityEvent(p: {
  id: string;
  sport: string; // lower-case sport name, e.g. "ride"
  name: string;
  date: string;
  start: number;
  end: number;
  meet: boolean; // ride and run say "Meet at"
  spot: { name: string; lat: number; lng: number; maps_url: string; note: string };
  routes: { label: string; name: string; url: string }[];
  details: string;
  notes: string;
}): CalEvent {
  return {
    id: p.id,
    date: p.date,
    start: p.start,
    end: p.end,
    title: `BBT ${p.sport}: ${p.name}`,
    // Coordinates, so calendar apps open the exact pin in Maps and car navigation can route to it.
    location: `${p.spot.lat}, ${p.spot.lng}`,
    geo: { lat: p.spot.lat, lng: p.spot.lng },
    details: [
      `${p.meet ? "Meet at" : "At"} ${p.spot.name}: ${p.spot.maps_url}`,
      p.spot.note ? `Notes: ${p.spot.note}` : "",
      p.details,
      ...p.routes.map((r) => `${r.label}: ${r.name} — ${r.url}`),
      p.notes ? `\n${p.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

// UTC times ("20261017T123000Z") work in every calendar and handle an activity ending after midnight.
export const icsTime = (date: string, min: number) =>
  `${nyToUTC(date, min).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
const stamp = (iso: string) => `${iso.replace(/[-:]/g, "").slice(0, 15)}Z`;

/** RFC 5545 line folding: at most 75 bytes per line, continuations start with a space. */
export function fold(line: string): string {
  // Printable ASCII (most lines): one byte per character, so cut by length.
  if (!/[^ -~]/.test(line)) {
    if (line.length <= 75) return line;
    const out = [line.slice(0, 75)];
    for (let i = 75; i < line.length; i += 74) out.push(` ${line.slice(i, i + 74)}`);
    return out.join("\r\n");
  }
  const parts: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const c = ch.codePointAt(0) ?? 0; // UTF-8 length, without an encoder per character (the feed's CPU budget is small)
    const n = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (bytes + n > 75) {
      parts.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  return [...parts, cur].join("\r\n");
}

const esc = (v: string) => v.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\r?\n|\r/g, "\\n");

// The team's time zone. Times stay in UTC; this is the calendar's display zone and keeps an empty feed valid RFC 5545
// (a calendar needs at least one component).
const NEW_YORK = [
  "BEGIN:VTIMEZONE",
  "TZID:America/New_York",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "TZNAME:EDT",
  "DTSTART:20070311T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "TZNAME:EST",
  "DTSTART:20071104T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/**
 * A calendar with these events; `feed` adds the name and refresh hint calendar apps use for subscriptions. A one-off
 * event gets its own UID: a subscribed calendar is a separate calendar, and some apps refuse to import a UID they
 * already hold there.
 */
export function icsCalendar(events: CalEvent[], feed = false): string {
  const now = stamp(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BBT//App//EN",
    "CALSCALE:GREGORIAN",
    ...(feed
      ? [
          "X-WR-CALNAME:BBT",
          "X-WR-TIMEZONE:America/New_York",
          "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
          "X-PUBLISHED-TTL:PT1H",
          ...NEW_YORK,
        ]
      : []),
    ...events.flatMap((e) => [
      "BEGIN:VEVENT",
      `UID:${e.id}${feed ? "" : "-once"}@app.bbt.team`,
      `DTSTAMP:${now}`,
      ...(e.updatedAt
        ? [`LAST-MODIFIED:${stamp(e.updatedAt)}`, `SEQUENCE:${Math.floor(Date.parse(e.updatedAt) / 1000)}`]
        : []),
      `DTSTART:${icsTime(e.date, e.start)}`,
      `DTEND:${icsTime(e.date, e.end)}`,
      `SUMMARY:${esc(e.cancelled ? `Cancelled: ${e.title}` : e.title)}`,
      `LOCATION:${esc(e.location)}`,
      `GEO:${e.geo.lat};${e.geo.lng}`,
      `DESCRIPTION:${esc(e.details)}`,
      ...(e.url ? [`URL:${e.url}`] : []),
      `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
