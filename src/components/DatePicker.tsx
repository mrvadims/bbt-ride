// Date field with its own calendar: weeks start on Monday and weekends are shaded, since most rides are on Sat/Sun.
// (A native <input type="date"> follows the device's locale and can't shade days.)
import { useEffect, useRef, useState } from "react";
import { addDays, dayLabel, dow, nyNow } from "../../shared/time.ts";
import { Sheet } from "./Sheet.tsx";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const monthOf = (date: string) => date.slice(0, 7); // "2026-10"
const shiftMonth = (ym: string, n: number) => {
  const d = new Date(`${ym}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};
const monthLabel = (ym: string) =>
  new Date(`${ym}-01T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

/** The Monday-first weeks a month spans (days outside it are null). */
function monthGrid(ym: string): (string | null)[] {
  const first = `${ym}-01`;
  const start = addDays(first, -((dow(first) + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const weeks = Math.ceil((days.findLastIndex((d) => monthOf(d) === ym) + 1) / 7);
  return days.slice(0, weeks * 7).map((d) => (monthOf(d) === ym ? d : null));
}

export function DatePicker({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: string;
  min: string;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthOf(value));
  const grid = useRef<HTMLDivElement>(null);
  const today = nyNow().date;
  const focusDay = (d: string) =>
    requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-date="${d}"]`)?.focus());
  // The dialog focuses its first control; start on the selected day instead.
  useEffect(() => {
    if (open) focusDay(value);
  }, [open, value]);

  const show = () => {
    setMonth(monthOf(value));
    setOpen(true);
  };
  const pick = (d: string) => {
    onChange(d);
    setOpen(false);
  };
  // Arrow keys move a day or a week from the focused day, crossing months as needed; Enter/Space picks it.
  const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  const tabStop = month === monthOf(value) ? value : `${month}-01` < min ? min : `${month}-01`;

  return (
    <div className="field">
      {label}
      <button
        type="button"
        className="datefield"
        aria-haspopup="dialog"
        aria-label={`${label}: ${dayLabel(value, true)}, ${value.slice(0, 4)}`}
        onClick={show}
      >
        {dayLabel(value)}, {value.slice(0, 4)}
      </button>
      {open && (
        <Sheet label={`${label}: pick a date`} onClose={() => setOpen(false)}>
          <div className="cal-h">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              aria-label="Previous month"
              disabled={month <= monthOf(min)}
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              ‹
            </button>
            <b aria-live="polite">{monthLabel(month)}</b>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              aria-label="Next month"
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              ›
            </button>
          </div>
          <div
            className="cal"
            role="group"
            aria-label={monthLabel(month)}
            ref={grid}
            onKeyDown={(e) => {
              const step = keys[e.key];
              const from = (e.target as HTMLElement).dataset.date;
              if (step === undefined || !from) return;
              e.preventDefault();
              const to = addDays(from, step);
              if (to < min) return;
              setMonth(monthOf(to));
              focusDay(to);
            }}
          >
            {WEEKDAYS.map((w, i) => (
              <span key={w} className={`cal-wd${i > 4 ? " we" : ""}`} aria-hidden="true">
                {w}
              </span>
            ))}
            {monthGrid(month).map((d, i) =>
              d ? (
                <button
                  key={d}
                  type="button"
                  data-date={d}
                  className={`cal-d${i % 7 > 4 ? " we" : ""}${d === today ? " today" : ""}`}
                  aria-label={dayLabel(d, true)}
                  aria-pressed={d === value}
                  aria-current={d === today ? "date" : undefined}
                  disabled={d < min}
                  tabIndex={d === tabStop ? 0 : -1}
                  onClick={() => pick(d)}
                >
                  {Number(d.slice(8))}
                </button>
              ) : (
                <span key={i} className="cal-d empty" />
              ),
            )}
          </div>
          <div className="btnrow" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => pick(today)}>
              Today
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
