// Adding one activity to a calendar: Google and Outlook links, or an .ics file generated in the browser (an iPhone
// Home Screen app doesn't share its sign-in with Safari, so a server link wouldn't work there). The subscribable feed of
// everything someone is in for is the calendar link (worker/routes/calendar.ts).
import { type CalEvent, icsCalendar, icsTime } from "../../shared/ics.ts";
import { nyToUTC } from "../../shared/time.ts";

export type { CalEvent };

export const googleLink = (c: CalEvent) =>
  `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: "TEMPLATE",
    text: c.title,
    dates: `${icsTime(c.date, c.start)}/${icsTime(c.date, c.end)}`,
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

export function downloadIcs(c: CalEvent) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([icsCalendar([c])], { type: "text/calendar" }));
  a.download = `bbt-${c.date}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
