// Add or edit a place (start spot, pool, courts…): name and Google Maps link required, notes optional (Plan and Settings).
import { useState } from "react";

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
        Google Maps link
        <input
          required
          value={f.link}
          onChange={(e) => setF({ ...f, link: e.target.value })}
          placeholder="Paste a Maps link, or 41.0454, -73.6973"
          maxLength={2000}
        />
      </label>
      <span className="tiny muted" style={{ marginTop: -8 }}>
        In Google Maps: drop a pin (on the parking spot for rides and runs) → Share → Copy link.
      </span>
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
