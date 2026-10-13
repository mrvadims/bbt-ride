// iCalendar (.ics) text for one activity (the Calendar tile) or a person's whole feed (the calendar link), RFC 5545.
import { nyToUTC } from "./time.ts";

export interface CalEvent {
  id: string; // activity id, so an event added once and the feed's copy are the same event
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
  const parts: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
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

/** A calendar with these events; `feed` adds the name and refresh hint calendar apps use for subscriptions. */
export function icsCalendar(events: CalEvent[], feed = false): string {
  const now = stamp(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BBT//App//EN",
    "CALSCALE:GREGORIAN",
    ...(feed ? ["X-WR-CALNAME:BBT", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"] : []),
    ...events.flatMap((e) => [
      "BEGIN:VEVENT",
      `UID:${e.id}@app.bbt.team`,
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
