// Calendar links and .ics (generated in the browser: an iPhone Home Screen app doesn't share its sign-in with Safari).
import { nyToUTC } from "../../shared/time.ts";

export interface CalEvent {
  date: string;
  start: number; // minutes after midnight, New York
  end: number;
  title: string;
  location: string;
  geo: { lat: number; lng: number };
  details: string;
}

// UTC times ("20261017T123000Z") work in every calendar and handle a ride ending after midnight.
const utc = (c: CalEvent, min: number) => `${nyToUTC(c.date, min).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;

export const googleLink = (c: CalEvent) =>
  `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: "TEMPLATE",
    text: c.title,
    dates: `${utc(c, c.start)}/${utc(c, c.end)}`,
    location: c.location,
    details: c.details,
  })}`;

export const outlookLink = (c: CalEvent, host: "outlook.live.com" | "outlook.office.com") =>
  `https://${host}/calendar/0/deeplink/compose?${new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: c.title,
    startdt: nyToUTC(c.date, c.start).toISOString(),
    enddt: nyToUTC(c.date, c.end).toISOString(),
    location: c.location,
    body: c.details,
  })}`;

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

export function downloadIcs(c: CalEvent, uid: string) {
  const e = (v: string) => v.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const text = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BBT//Ride//EN",
    "BEGIN:VEVENT",
    `UID:${uid}@ride.bbt.team`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART:${utc(c, c.start)}`,
    `DTEND:${utc(c, c.end)}`,
    `SUMMARY:${e(c.title)}`,
    `LOCATION:${e(c.location)}`,
    `GEO:${c.geo.lat};${c.geo.lng}`,
    `DESCRIPTION:${e(c.details)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .map(fold)
    .join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
  a.download = `bbt-ride-${c.date}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
