// The person's private calendar link (DESIGN.md → v2, Calendar link): subscribe in Apple or Google Calendar, copy it
// for anything else, or reset it. The link is made the first time it's needed.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Me } from "../../shared/api.ts";
import { api } from "../lib/api.ts";
import { useMe } from "../lib/data.ts";

export function CalendarLink() {
  const me = useMe().data;
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  if (!me) return null;
  const ensure = async (): Promise<string> => {
    if (me.calendarUrl) return me.calendarUrl;
    const next = await api<Me>("/me/calendar", { method: "POST" });
    qc.setQueryData(["me"], next);
    return next.calendarUrl as string;
  };
  const run = (f: (url: string) => void | Promise<void>) => async () => {
    setNote("");
    try {
      await f(await ensure());
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const webcal = (url: string) => url.replace(/^https:/, "webcal:");
  const reset = async () => {
    if (!window.confirm("Make a new calendar link? Calendars subscribed to the old one stop updating.")) return;
    setNote("");
    try {
      qc.setQueryData(["me"], await api<Me>("/me/calendar", { method: "POST" }));
      setNote("New link made. Subscribe again with it.");
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  return (
    <div className="callink">
      <div className="btnrow">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={run((url) => {
            location.href = webcal(url);
          })}
        >
          Apple Calendar
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={run((url) => {
            window.open(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal(url))}`, "_blank");
          })}
        >
          Google Calendar
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={run(async (url) => {
            await navigator.clipboard.writeText(url);
            setNote("Link copied. In Outlook or another app, add a calendar from the internet and paste it.");
          })}
        >
          Copy link
        </button>
        {me.calendarUrl && (
          <button type="button" className="linkbtn tiny" onClick={reset}>
            Reset link
          </button>
        )}
      </div>
      {note && (
        <p className="tiny muted" role="status" style={{ margin: "6px 0 0" }}>
          {note}
        </p>
      )}
    </div>
  );
}
