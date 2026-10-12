// Ride page: date tabs (this weekend + any upcoming day with a ride) plus Past (DESIGN.md → Rides, Past rides).
import { useState } from "react";
import type { Me, RideDetail, RideSummary } from "../../shared/api.ts";
import { M_PER_MI } from "../../shared/ride.ts";
import { dayLabel, fmtStamp, fmtTime, nyNow, weekendDates } from "../../shared/time.ts";
import { EditIcon, LevelIcon, ShareIcon } from "../components/icons.tsx";
import { RideBody } from "../components/RideBody.tsx";
import { Riders } from "../components/Riders.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { useRide, useRides, useSpots } from "../lib/data.ts";
import { usePrefs } from "../lib/prefs.ts";
import { type RideModel, useRideModel } from "../lib/rideModel.ts";
import { Link, navigate } from "../lib/router.tsx";
import { units } from "../lib/units.ts";

/** Tabs: this weekend plus any upcoming day with a ride (published or cancelled). */
export function rideDays(rides: RideSummary[]): string[] {
  const days = new Set<string>(weekendDates(nyNow().date));
  for (const r of rides) days.add(r.date);
  return [...days].sort();
}

/** The ride shown for a date: the published one, else the latest cancelled one. */
export const rideOn = (rides: RideSummary[], date: string) =>
  rides.find((r) => r.date === date && r.status === "published") ?? rides.filter((r) => r.date === date).at(-1);

export function DayTabs({ days, current }: { days: string[]; current: string }) {
  return (
    <nav className="daytabs" aria-label="Ride days">
      {days.map((d) => (
        <Link key={d} className="tab" href={`/ride/${d}`} aria-current={d === current ? "page" : undefined}>
          {dayLabel(d)}
        </Link>
      ))}
      <Link className="tab" href="/past" aria-current={current === "past" ? "page" : undefined}>
        Past
      </Link>
    </nav>
  );
}

function shareText(ride: RideDetail, m: RideModel, u: ReturnType<typeof units>): string {
  const st = m.ev?.st;
  const lines = [
    `${ride.status === "cancelled" ? "CANCELLED: " : ""}BBT ride · ${dayLabel(ride.date, true)}`,
    `Meet ${fmtTime(m.t.start)} · ${m.spot.name} ${m.spot.maps_url}`,
    ...ride.routes.map((r) => {
      const rr = m.routeById(r.routeId);
      const name = rr ? `${rr.name} (${u.dist(rr.distance_m / M_PER_MI)}) ${rr.url}` : `#${r.routeId}`;
      return `${ride.routes.length > 1 ? `${r.label}: ` : "Route: "}${name}`;
    }),
    m.t.stop ? `Coffee: ${m.t.stop.poi.name} ≈ ${fmtTime(m.t.stop.eta)} (optional)` : null,
    `Back ≈ ${fmtTime(m.t.end)}`,
    st
      ? `Weather: ${u.temp(st.tMin)}–${u.temp(st.tMax)}, feels ${u.temp(st.appMin)}–${u.temp(st.appMax)}, wind ${u.speed(st.wsMax)} ${u.speedUnit}, rain ${Math.round(st.ppMax)}%${st.road.state !== "Dry" ? `, roads ${st.road.state.toLowerCase()}` : ""}`
      : null,
    ride.notes ? `Notes: ${ride.notes.replace(/\n/g, " ")}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

function ShareSheet({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Sheet label="Share ride" onClose={onClose}>
      <h2>Share ride</h2>
      <p className="small muted" style={{ margin: "4px 0 8px" }}>
        Copy and paste into any app.
      </p>
      <textarea readOnly rows={9} value={text} onFocus={(e) => e.target.select()} />
      <div className="btnrow" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn btn-outline" onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  );
}

function RideView({ ride, me, days }: { ride: RideDetail; me: Me; days: string[] }) {
  const [routeIndex, setRouteIndex] = useState(0);
  const [sheet, setSheet] = useState<string | null>(null);
  const m = useRideModel(ride, routeIndex);
  const u = units(usePrefs().units);
  const share = () => {
    if (!m || m.loading) return;
    const text = shareText(ride, m, u);
    const url = `${location.origin}/ride/${ride.date}`;
    if (navigator.share)
      navigator.share({ title: `BBT ride ${dayLabel(ride.date)}`, text, url }).catch(() => undefined);
    else setSheet(`${text}\n${url}`);
  };
  const last = ride.lastUpdate;
  return (
    <>
      <div className="dayrow">
        <DayTabs days={days} current={ride.date} />
        {me.role !== "view" && (
          <button
            type="button"
            className="iconbtn share"
            aria-label="Edit this ride"
            title="Edit ride"
            onClick={() => navigate(`/plan?edit=${ride.id}`)}
          >
            <EditIcon />
          </button>
        )}
        <button type="button" className="iconbtn share" aria-label="Share this ride" title="Share" onClick={share}>
          <ShareIcon />
        </button>
      </div>
      {ride.status === "cancelled" ? (
        <div className="warn lv2 big">
          <LevelIcon level={2} />
          <div>
            <b>Ride cancelled</b>
            <span>Check the Riders panel for messages.</span>
          </div>
        </div>
      ) : (
        last && (
          <div className="notice">
            <b>Updated {fmtStamp(last.at)}</b> · {last.text}
          </div>
        )
      )}
      {!m || m.loading ? (
        <p className="muted small">Loading the ride…</p>
      ) : (
        <RideBody
          ride={ride}
          model={m}
          mode="upcoming"
          routeIndex={routeIndex}
          onRouteIndex={setRouteIndex}
          riders={<Riders ride={ride} me={me} past={false} />}
        />
      )}
      {sheet && <ShareSheet text={sheet} onClose={() => setSheet(null)} />}
    </>
  );
}

export function RidePage({ me, date }: { me: Me; date: string | undefined }) {
  const rides = useRides();
  useSpots(); // warm the cache for the panels
  const days = rideDays(rides.data ?? []);
  const current =
    date && days.includes(date) ? date : (days.find((d) => rides.data && rideOn(rides.data, d)) ?? days[0] ?? "");
  const summary = rides.data ? rideOn(rides.data, current) : undefined;
  const detail = useRide(summary?.id);
  if (rides.isPending) return <p className="muted small">Loading rides…</p>;
  if (rides.isError) return <p role="alert">{rides.error.message}</p>;
  if (!summary) {
    return (
      <>
        <div className="dayrow">
          <DayTabs days={days} current={current} />
        </div>
        <section className="panel empty">
          <p>
            <b>No ride posted for {dayLabel(current, true)}.</b>
          </p>
          {me.role !== "view" ? (
            <Link className="btn btn-primary btn-sm" href={`/plan?date=${current}`}>
              Plan a ride
            </Link>
          ) : (
            <p className="muted small">Check back later.</p>
          )}
        </section>
      </>
    );
  }
  return detail.data ? (
    <RideView key={detail.data.id} ride={detail.data} me={me} days={days} />
  ) : detail.isError ? (
    <p className="small" role="alert">
      Couldn't load the ride: {detail.error.message}
    </p>
  ) : (
    <p className="muted small">Loading the ride…</p>
  );
}
