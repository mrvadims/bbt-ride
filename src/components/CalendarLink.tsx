// The person's private calendar link (DESIGN.md → v2, Calendar link): subscribe in Apple or Google Calendar, copy it
// for anything else, or reset it. The link is made with its own tap first, so Copy and Google Calendar run straight from
// the tap that asks for them (Safari blocks the clipboard and new windows after waiting on the network).
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Me } from "../../shared/api.ts";
import { api } from "../lib/api.ts";
import { useMe } from "../lib/data.ts";
import { isApp } from "../lib/native.ts";

export function CalendarLink() {
  const me = useMe().data;
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const post = async (path: string, done: string) => {
    setNote("");
    setBusy(true);
    try {
      qc.setQueryData(["me"], await api<Me>(path, { method: "POST" }));
      setNote(done);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const url = me.calendarUrl;
  // Apple Calendar only subscribes from a webcal: link; Google takes the https link itself, so it never fetches in clear.
  const webcal = url?.replace(/^https:/, "webcal:") ?? "";
  const copy = async () => {
    setNote("");
    try {
      await navigator.clipboard.writeText(url ?? "");
      setNote("Link copied. In Outlook or another app, add a calendar from the internet and paste it.");
    } catch {
      setNote(url ?? "");
    }
  };
  const reset = () => {
    if (window.confirm("Make a new calendar link? Calendars subscribed to the old one stop updating."))
      post("/me/calendar/reset", "New link made. Subscribe again with it.");
  };
  return (
    <div>
      {url ? (
        <div className="btnrow">
          {!isApp() && ( // Android has no Apple Calendar
            <a className="btn btn-outline btn-sm" href={webcal}>
              Apple Calendar
            </a>
          )}
          <a
            className="btn btn-outline btn-sm"
            href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noreferrer"
          >
            Google Calendar
          </a>
          <button type="button" className="btn btn-outline btn-sm" onClick={copy}>
            Copy link
          </button>
          <button type="button" className="linkbtn tiny" onClick={reset} disabled={busy}>
            Reset link
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={busy}
          onClick={() => post("/me/calendar", "")}
        >
          Get my calendar link
        </button>
      )}
      {note && (
        <p className="tiny muted" role="status" style={{ margin: "6px 0 0", overflowWrap: "anywhere" }}>
          {note}
        </p>
      )}
    </div>
  );
}
