// Past rides: newest first, grouped by month, searchable; a past ride opens read-only (DESIGN.md → Past rides).
import { useState } from "react";
import type { Me } from "../../shared/api.ts";
import { dayLabel } from "../../shared/time.ts";
import { LevelIcon } from "../components/icons.tsx";
import { RideBody } from "../components/RideBody.tsx";
import { Riders } from "../components/Riders.tsx";
import { Pill } from "../components/Warnings.tsx";
import { usePast, useRide, useRides, useSpots } from "../lib/data.ts";
import { usePrefs } from "../lib/prefs.ts";
import { useRideModel } from "../lib/rideModel.ts";
import { Link, navigate } from "../lib/router.tsx";
import { units } from "../lib/units.ts";
import { DayTabs, rideDays } from "./RidePage.tsx";

export function PastList() {
  const past = usePast();
  const spots = useSpots().data ?? [];
  const rides = useRides().data ?? [];
  const u = units(usePrefs().units);
  const [q, setQ] = useState("");
  const spotName = (id: string) => spots.find((s) => s.id === id)?.name ?? "";
  const list = (past.data ?? []).filter((r) => {
    if (!q.trim()) return true;
    return `${spotName(r.spotId)} ${r.routes.map((x) => x.name ?? "").join(" ")}`
      .toLowerCase()
      .includes(q.trim().toLowerCase());
  });
  const byMonth = new Map<string, typeof list>();
  for (const r of list) {
    const m = new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    });
    byMonth.set(m, [...(byMonth.get(m) ?? []), r]);
  }
  return (
    <>
      <div className="dayrow">
        <DayTabs days={rideDays(rides)} current="past" />
      </div>
      <h1 className="sr">Past rides</h1>
      <label className="field" style={{ marginBottom: 4 }}>
        Search past rides
        <input
          type="search"
          placeholder="Route or spot, e.g. Katonah"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
      </label>
      {past.isPending && <p className="muted small">Loading…</p>}
      {past.isError && (
        <p className="small" role="alert">
          Couldn't load past rides: {past.error.message}
        </p>
      )}
      {[...byMonth].map(([month, rs]) => (
        <div key={month}>
          <div className="kicker" style={{ margin: "14px 0 6px" }}>
            {month}
          </div>
          <div className="spotlist">
            {rs.map((r) => (
              <Link key={r.id} className="spotrow" href={`/past/${r.id}`}>
                <span className="spotrow-b">
                  <b>
                    {dayLabel(r.date)} · {spotName(r.spotId)}
                  </b>
                  <span className="small">{r.routes.map((x) => x.name ?? `Route #${x.routeId}`).join(" / ")}</span>
                  <span className="small muted">
                    {r.status === "cancelled" ? <Pill level={2}>Cancelled</Pill> : `${r.counts.in} rode · `}
                    {r.observed
                      ? ` ${u.temp(r.observed.T)}, feels ${u.temp(r.observed.app)} · wind ${u.speed(r.observed.ws)} · roads ${r.observed.road.toLowerCase()}`
                      : ""}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}
      {past.data && !list.length && (
        <p className="muted small" style={{ marginTop: 12 }}>
          {q ? "No past rides match." : "No past rides yet."}
        </p>
      )}
    </>
  );
}

export function PastRide({ id, me }: { id: string; me: Me }) {
  const rideQ = useRide(id);
  const ride = rideQ.data;
  const [routeIndex, setRouteIndex] = useState(0);
  const m = useRideModel(ride ?? null, routeIndex);
  const rides = useRides().data ?? [];
  if (rideQ.isError)
    return (
      <p className="small" role="alert">
        Couldn't load the ride: {rideQ.error.message}
      </p>
    );
  if (!ride) return <p className="muted small">Loading…</p>;
  const reuse = () => navigate(`/plan?reuse=${ride.id}`);
  return (
    <>
      <div className="dayrow">
        <DayTabs days={rideDays(rides)} current="past" />
      </div>
      <div className="pasthead">
        <Link className="small" href="/past">
          ← Past rides
        </Link>
        <span className="muted small">{dayLabel(ride.date, true)}</span>
        {me.role !== "view" && (
          <button type="button" className="btn btn-outline btn-sm" onClick={reuse}>
            Reuse this plan
          </button>
        )}
      </div>
      {ride.status === "cancelled" && (
        <div className="warn lv2 big">
          <LevelIcon level={2} />
          <div>
            <b>Ride cancelled</b>
            <span>{ride.messages.find((x) => x.kind === "cancel")?.body ?? ""}</span>
          </div>
        </div>
      )}
      {!m || m.loading ? (
        <p className="muted small">Loading…</p>
      ) : (
        <RideBody
          ride={ride}
          model={m}
          mode="past"
          routeIndex={routeIndex}
          onRouteIndex={setRouteIndex}
          riders={<Riders ride={ride} me={me} past />}
        />
      )}
    </>
  );
}
