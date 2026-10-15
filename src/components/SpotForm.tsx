// Add or edit a place (start spot, pool, courts…, or an online meeting): name and a Google Maps or meeting link required,
// notes optional (Plan and Settings).
import { useState } from "react";
import { meetingLink, onlineService } from "../../shared/ride.ts";
import { VideoIcon } from "./icons.tsx";

export interface SpotFields {
  name: string;
  link: string;
  note: string;
}

export function SpotForm({
  title,
  initial = { name: "", link: "", note: "" },
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: SpotFields;
  submitLabel: string;
  onSubmit: (f: SpotFields) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const complete = f.name.trim() && f.link.trim();
  const meeting = meetingLink(f.link);
  return (
    <form
      className="newspot"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        await onSubmit({ name: f.name.trim(), link: f.link.trim(), note: f.note.trim() }).catch((err: Error) =>
          setMsg(err.message),
        );
        setBusy(false);
      }}
    >
      <div className="sub-h">{title}</div>
      <label className="field">
        Name
        <input
          required
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="e.g. Rockefeller Preserve"
          maxLength={80}
        />
      </label>
      <label className="field">
        Map or meeting link
        <input
          required
          value={f.link}
          onChange={(e) => setF({ ...f, link: e.target.value })}
          placeholder="A Maps link, 41.0454, -73.6973, or a Zoom link"
          maxLength={2000}
        />
      </label>
      {meeting ? (
        <p className="online-note">
          <VideoIcon size={20} />
          <span>
            <b>Online · {onlineService(meeting)}</b>
            <br />
            <span className="small muted">No map or weather. Activities here get a Join button.</span>
          </span>
        </p>
      ) : (
        <span className="tiny muted" style={{ marginTop: -8 }}>
          In Google Maps: drop a pin (on the parking spot for rides and runs) → Share → Copy link. For an online
          meet-up, paste the meeting link (Zoom, Google Meet, Teams…).
        </span>
      )}
      <label className="field">
        Notes (optional)
        <textarea
          value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })}
          placeholder="Where to park, entrance, restrooms…"
          maxLength={1000}
        />
      </label>
      {msg && (
        <p className="small" role="alert" style={{ color: "var(--no-fg)", margin: 0 }}>
          {msg}
        </p>
      )}
      <div className="btnrow">
        <button type="submit" className="btn btn-primary btn-sm" disabled={!complete || busy}>
          {submitLabel}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
