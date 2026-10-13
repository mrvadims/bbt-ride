// Home: every upcoming activity, soonest first, with sport filters when more than one sport is coming up
// (DESIGN.md → v2, What changes for people).
import { useState } from "react";
import { type Activity, activityName, type Me } from "../../shared/api.ts";
import { SPORT_LABEL, type Sport } from "../../shared/sports.ts";
import { dayLabel, fmtTime, hhmmToMin } from "../../shared/time.ts";
import { SportIcon } from "../components/icons.tsx";
import { Pill, WarningChips } from "../components/Warnings.tsx";
import { useActivityModel } from "../lib/activityModel.ts";
import { useActivities, useSpots } from "../lib/data.ts";
import { usePrefs } from "../lib/prefs.ts";
import { Link } from "../lib/router.tsx";
import { units } from "../lib/units.ts";

function Row({ a, spotName }: { a: Activity; spotName: string }) {
  const m = useActivityModel(a.status === "published" ? a : null);
  const u = units(usePrefs().units);
  const chips = m && !m.loading ? m.warnings : [];
  return (
    <Link className="arow" href={`/a/${a.id}`}>
      <span className="arow-icon">
        <SportIcon sport={a.sport} />
      </span>
      <span className="arow-b">
        <span className="kicker">
          {dayLabel(a.date)} · {fmtTime(hhmmToMin(a.startTime))}
        </span>
        <b>{activityName(a)}</b>
        <span className="small muted">
          {spotName}
          {a.details ? ` · ${a.details}` : ""}
          {a.outdoor ? "" : " · indoor"}
        </span>
      </span>
      <span className="arow-r">
        {a.status === "cancelled" ? (
          <Pill level={2}>Cancelled</Pill>
        ) : (
          <WarningChips list={chips} u={u} lookback={m && !m.loading ? m.settings.lookback : 12} />
        )}
        <span className="tiny muted">{a.counts.in} in</span>
      </span>
    </Link>
  );
}

export function HomePage({ me }: { me: Me }) {
  const list = useActivities();
  const spots = useSpots().data ?? [];
  const [sport, setSport] = useState<Sport | "all">("all");
  if (list.isPending) return <p className="muted small">Loading…</p>;
  if (list.isError && !list.data) return <p role="alert">{list.error.message}</p>;
  // A cancelled activity stays listed (so people see it's off) unless the same sport has a published one that day,
  // e.g. after Replace.
  const all = list.data.filter(
    (a) =>
      a.status === "published" ||
      !list.data.some((b) => b.status === "published" && b.date === a.date && b.sport === a.sport),
  );
  const sports = [...new Set(all.map((a) => a.sport))];
  const pick = sports.includes(sport as Sport) ? sport : "all"; // the chosen sport may have nothing left
  const shown = all.filter((a) => pick === "all" || a.sport === pick);
  const spotName = (id: string) => spots.find((s) => s.id === id)?.name ?? "";
  return (
    <>
      <h1 className="sr">Upcoming</h1>
      {sports.length > 1 && (
        <div className="filters" role="group" aria-label="Show">
          {(["all", ...sports] as const).map((s) => (
            <button key={s} type="button" aria-pressed={pick === s} onClick={() => setSport(s)}>
              {s === "all" ? "All" : SPORT_LABEL[s]}
            </button>
          ))}
        </div>
      )}
      {shown.length ? (
        <div className="alist">
          {shown.map((a) => (
            <Row key={a.id} a={a} spotName={spotName(a.spotId)} />
          ))}
        </div>
      ) : (
        <section className="panel empty">
          <p>
            <b>Nothing planned yet.</b>
          </p>
          {me.role !== "view" ? (
            <Link className="btn btn-primary btn-sm" href="/plan">
              Plan an activity
            </Link>
          ) : (
            <p className="muted small">Check back later.</p>
          )}
        </section>
      )}
      <p className="center">
        <Link className="small" href="/past">
          Past activities
        </Link>
      </p>
    </>
  );
}
