// Past activities: newest first, grouped by month, with a sport filter and search; each opens read-only
// (DESIGN.md → v2, What changes for people).
import { useState } from "react";
import { activityName } from "../../shared/api.ts";
import { SPORT_LABEL, type Sport } from "../../shared/sports.ts";
import { dayLabel } from "../../shared/time.ts";
import { SportIcon } from "../components/icons.tsx";
import { Pill } from "../components/Warnings.tsx";
import { usePast, useSpots } from "../lib/data.ts";
import { usePrefs } from "../lib/prefs.ts";
import { Link } from "../lib/router.tsx";
import { units } from "../lib/units.ts";

export function PastList() {
  const past = usePast();
  const spots = useSpots().data ?? [];
  const u = units(usePrefs().units);
  const [q, setQ] = useState("");
  const [sport, setSport] = useState<Sport | "all">("all");
  const spotName = (id: string) => spots.find((s) => s.id === id)?.name ?? "";
  const all = past.data ?? [];
  const sports = [...new Set(all.map((a) => a.sport))];
  const list = all.filter(
    (a) =>
      (sport === "all" || a.sport === sport) &&
      (!q.trim() ||
        `${activityName(a)} ${spotName(a.spotId)} ${a.routes.map((x) => x.name ?? "").join(" ")}`
          .toLowerCase()
          .includes(q.trim().toLowerCase())),
  );
  const byMonth = new Map<string, typeof list>();
  for (const a of list) {
    const m = new Date(`${a.date}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    });
    byMonth.set(m, [...(byMonth.get(m) ?? []), a]);
  }
  return (
    <>
      <p className="small" style={{ margin: "0 0 8px" }}>
        <Link href="/">← Upcoming</Link>
      </p>
      <h1 className="sr">Past activities</h1>
      {sports.length > 1 && (
        <div className="filters" role="group" aria-label="Show">
          {(["all", ...sports] as const).map((s) => (
            <button key={s} type="button" aria-pressed={sport === s} onClick={() => setSport(s)}>
              {s === "all" ? "All" : SPORT_LABEL[s]}
            </button>
          ))}
        </div>
      )}
      <label className="field" style={{ marginBottom: 4 }}>
        Search past activities
        <input
          type="search"
          placeholder="Title, route or place, e.g. Katonah"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
      </label>
      {past.isPending && <p className="muted small">Loading…</p>}
      {past.isError && (
        <p className="small" role="alert">
          Couldn't load past activities: {past.error.message}
        </p>
      )}
      {[...byMonth].map(([month, as]) => (
        <div key={month}>
          <div className="kicker" style={{ margin: "14px 0 6px" }}>
            {month}
          </div>
          <div className="alist">
            {as.map((a) => (
              <Link key={a.id} className="arow" href={`/a/${a.id}`}>
                <span className="arow-icon">
                  <SportIcon sport={a.sport} icon={a.icon} />
                </span>
                <span className="arow-b">
                  <span className="kicker">{dayLabel(a.date)}</span>
                  <b>{activityName(a)}</b>
                  <span className="small muted">
                    {spotName(a.spotId)}
                    {a.observed
                      ? ` · ${u.temp(a.observed.T)}, feels ${u.temp(a.observed.app)} · wind ${u.speed(a.observed.ws)}`
                      : ""}
                  </span>
                </span>
                <span className="arow-r">
                  {a.status === "cancelled" ? (
                    <Pill level={2}>Cancelled</Pill>
                  ) : (
                    <span className="tiny muted">{a.counts.in} joined</span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}
      {past.data && !list.length && (
        <p className="muted small" style={{ marginTop: 12 }}>
          {q || sport !== "all" ? "Nothing matches." : "Nothing in the past yet."}
        </p>
      )}
    </>
  );
}
