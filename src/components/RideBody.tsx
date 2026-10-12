// Warnings + Meet / Route / Weather / Notes panels (DESIGN.md → Rides). Used by the ride page, past rides and Plan's preview.
import { lazy, type ReactNode, Suspense, useState } from "react";
import type { RecordedWeather } from "../../shared/api.ts";
import { KIT_OFFSETS, type KitAdvice, type KitOffset } from "../../shared/kit.ts";
import { M_PER_MI, mapsLink, type Spot } from "../../shared/ride.ts";
import { fmtDur, fmtTime } from "../../shared/time.ts";
import { bikeFeel, compass } from "../../shared/weather.ts";
import { type CalEvent, downloadIcs, googleLink, outlookLink } from "../lib/calendar.ts";
import { type Prefs, setPref, usePrefs } from "../lib/prefs.ts";
import type { RideLike, RideModel } from "../lib/rideModel.ts";
import { type Units, units } from "../lib/units.ts";
import { ElevationChart } from "./charts.tsx";
import { HourTable } from "./HourTable.tsx";
import { WxIcon, wxLabel } from "./icons.tsx";
import { EmptyPanel, Panel } from "./Panel.tsx";

// The map library is large; load it only when a Route panel opens.
const RouteMap = lazy(() => import("./RouteMap.tsx").then((m) => ({ default: m.RouteMap })));

import { Sheet } from "./Sheet.tsx";
import { WarningBoxes } from "./Warnings.tsx";

const WX_APPS: Record<Prefs["wxApp"], { name: string; url: (s: Spot) => string }> = {
  nws: {
    name: "NWS",
    url: (s) => `https://forecast.weather.gov/MapClick.php?lat=${s.lat}&lon=${s.lng}&FcstType=graphical`,
  },
  weathercom: {
    name: "Weather.com",
    url: (s) => `https://weather.com/weather/hourbyhour/l/${s.lat.toFixed(3)},${s.lng.toFixed(3)}`,
  },
  windy: {
    name: "Windy",
    url: (s) =>
      `https://www.windy.com/${s.lat.toFixed(3)}/${s.lng.toFixed(3)}?${s.lat.toFixed(3)},${s.lng.toFixed(3)},11`,
  },
  google: {
    name: "Google",
    url: (s) => `https://www.google.com/search?q=${encodeURIComponent(`hourly weather ${s.name} NY`)}`,
  },
};

/** "Full-day forecast in <app>" plus the rider's choice of weather app. */
export function WeatherAppRow({ spot, extra }: { spot: Spot; extra?: ReactNode }) {
  const { wxApp } = usePrefs();
  const app = WX_APPS[wxApp] ?? WX_APPS.nws;
  return (
    <div className="btnrow" style={{ marginTop: 10, alignItems: "center" }}>
      <a className="btn btn-outline btn-sm" href={app.url(spot)} target="_blank" rel="noopener noreferrer">
        Full-day forecast in {app.name}
      </a>
      {extra}
      <label className="tiny muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        Open in
        <select
          value={wxApp}
          onChange={(e) => setPref("wxApp", e.target.value as Prefs["wxApp"])}
          style={{ minHeight: 32, padding: "4px 8px", width: "auto" }}
        >
          {Object.entries(WX_APPS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export const wxSummary = (st: NonNullable<RideModel["ev"]>["st"], u: Units) => (
  <>
    <b>
      {u.temp(st.tMin)}–{u.temp(st.tMax)}
    </b>{" "}
    · feels {u.temp(st.appMin)}–{u.temp(st.appMax)} · wind {u.speed(st.wsMax)} · rain {Math.round(st.ppMax)}%
  </>
);

export const roadNote = (st: NonNullable<RideModel["ev"]>["st"], u: Units, lookback: number) =>
  `roads ${st.road.state.toLowerCase()} (${st.road.rained ? `${u.rain(st.road.rainIn)} in last ${lookback} h` : `no rain in ${lookback} h`})`;

const ADD_ON_TEXT = (a: KitAdvice["addOns"][number], u: Units) => {
  switch (a.kind) {
    case "rainJacket":
      return {
        name: "Packable rain jacket",
        why: `${Math.round(a.pp)}% chance of rain, ${u.rain(a.rain)} expected`,
        short: "rain jacket",
      };
    case "fenders":
      return {
        name: "Clip-on fenders + shoe covers",
        why: `roads ${a.road.toLowerCase()} at roll-out`,
        short: "fenders",
      };
    case "windVest":
      return { name: "Wind vest", why: `wind up to ${u.speed(a.ws)} ${u.speedUnit}`, short: "wind vest" };
    case "thunder":
      return { name: "Rethink the ride", why: "thunderstorms in the window", short: "thunder" };
  }
};

function WhatToWear({ kit, feelMin, u }: { kit: KitAdvice; feelMin: number; u: Units }) {
  const { kitOffset } = usePrefs();
  return (
    <div className="sub">
      <div className="sub-h">
        What to wear
        <div className="seg" role="group" aria-label="I usually run">
          {(Object.keys(KIT_OFFSETS) as KitOffset[]).map((o) => (
            <button key={o} type="button" aria-pressed={kitOffset === o} onClick={() => setPref("kitOffset", o)}>
              {o === "avg" ? "Avg" : o === "cold" ? "Run cold" : "Run hot"}
            </button>
          ))}
        </div>
      </div>
      <div className="muted small">
        {kit.band.name} · bike feel {u.temp(feelMin)}
        {kit.offset ? ` (feels like ${u.temp(feelMin + kit.offset)} to you)` : ""}
      </div>
      <ul className="wear-list">
        {kit.band.items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      {kit.shed && (
        <div className="addon">
          Warms up {u.tempDelta(kit.shed.spread)} — dress for {kit.band.name.toLowerCase()} and pack layers to shed down
          to {kit.shed.to.name.toLowerCase()}.
        </div>
      )}
      {kit.addOns.map((a) => {
        const t = ADD_ON_TEXT(a, u);
        return (
          <div key={t.name} className="addon">
            <b>+ {t.name}</b> <span className="muted">— {t.why}</span>
          </div>
        );
      })}
    </div>
  );
}

function CalendarSheet({ ev, uid, onClose }: { ev: CalEvent; uid: string; onClose: () => void }) {
  const ics = () => {
    downloadIcs(ev, uid);
    onClose();
  };
  return (
    <Sheet label="Add to calendar" onClose={onClose}>
      <h2>Add to calendar</h2>
      <p className="small muted" style={{ margin: "4px 0 10px" }}>
        {fmtTime(ev.start)}–{fmtTime(ev.end)} · {ev.title}
      </p>
      <div className="choices">
        <a href={googleLink(ev)} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          Google Calendar
        </a>
        <button type="button" onClick={ics}>
          Apple Calendar <span>.ics file</span>
        </button>
        <a href={outlookLink(ev, "outlook.live.com")} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          Outlook.com
        </a>
        <a href={outlookLink(ev, "outlook.office.com")} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          Outlook (work or school)
        </a>
        <button type="button" onClick={ics}>
          Other <span>.ics file</span>
        </button>
      </div>
      <div className="btnrow" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-outline" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/** Calendar event for a ride: meet → back, at the parking pin, routes and notes in the description. */
function calendarEvent(ride: RideLike, m: RideModel): CalEvent {
  const lines = ride.routes.map((r) => {
    const route = m.routeById(r.routeId);
    return `${r.label}: ${route?.name ?? `#${r.routeId}`} — ${route?.url ?? ""}`;
  });
  return {
    date: ride.date,
    start: m.t.start,
    end: m.t.end,
    title: `BBT ride: ${m.route.name}`,
    location: `${m.spot.name} (${m.spot.maps_url})`,
    details: `${lines.join("\n")}\nParking: ${m.spot.note}${ride.notes ? `\n\n${ride.notes}` : ""}`,
  };
}

export function RideBody(props: {
  ride: RideLike & { id?: string; observed?: RecordedWeather | null };
  model: RideModel;
  mode: "upcoming" | "past" | "preview";
  routeIndex: number;
  onRouteIndex?: (i: number) => void;
  riders?: ReactNode;
}) {
  const { ride, model: m, mode } = props;
  const { units: unitPref } = usePrefs();
  const u = units(unitPref);
  const [calOpen, setCalOpen] = useState(false);
  const kp = mode === "preview" ? "pv-" : "";
  const { t, spot, route, ev, se, settings: s } = m;
  const st = ev?.st;
  const stop = t.stop;

  const meet = (
    <Panel
      id={`${kp}meet`}
      label="Meet"
      summary={
        <>
          <b>{fmtTime(t.start)}</b> ·{" "}
          <a href={spot.maps_url} target="_blank" rel="noopener noreferrer">
            {spot.name}
          </a>
        </>
      }
    >
      <dl className="kvlist">
        <div>
          <dt>Back</dt>
          <dd>
            <b>≈ {fmtTime(t.end)}</b>
            <span>
              {fmtDur(t.movingH)} moving + {Math.round(t.regroupMin)} min regroups
              {stop ? ` + ${stop.len} min coffee · ≈ ${fmtTime(t.end - stop.len)} without the stop` : ""}
            </span>
          </dd>
        </div>
        <div>
          <dt>Parking</dt>
          <dd>{spot.note || "No notes yet."}</dd>
        </div>
      </dl>
      <div className="btnrow">
        <a className="btn btn-outline btn-sm" href={spot.maps_url} target="_blank" rel="noopener noreferrer">
          Open in Google Maps
        </a>
        {mode === "upcoming" && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setCalOpen(true)}>
            + Calendar
          </button>
        )}
      </div>
      {calOpen && (
        <CalendarSheet
          ev={calendarEvent(ride, m)}
          uid={`${props.ride.id ?? "draft"}`}
          onClose={() => setCalOpen(false)}
        />
      )}
    </Panel>
  );

  const switcher =
    mode !== "preview" && ride.routes.length > 1 ? (
      <div className="seg" role="group" aria-label="Route">
        {ride.routes.map((r, i) => {
          const rr = m.routeById(r.routeId);
          return (
            <button
              key={r.label}
              type="button"
              aria-pressed={i === props.routeIndex}
              onClick={() => props.onRouteIndex?.(i)}
            >
              {r.label}
              {rr ? ` · ${u.dist(rr.distance_m / M_PER_MI, 0)}` : ""}
            </button>
          );
        })}
      </div>
    ) : null;

  const routePanel = (
    <Panel
      id={`${kp}route`}
      label="Route"
      summary={
        <>
          <a href={route.url} target="_blank" rel="noopener noreferrer">
            <b>{route.name}</b>
          </a>{" "}
          · {u.dist(t.distMi)} · {u.elev(t.climbFt)}
          {switcher && <div className="sw">{switcher}</div>}
        </>
      }
    >
      <Suspense fallback={<div className="map" />}>
        <RouteMap route={route} stop={stop?.poi ?? null} />
      </Suspense>
      <ElevationChart route={route} stopMile={stop ? stop.mile : null} u={u} />
      {stop && (
        <div className="sub">
          <div className="sub-h">
            Coffee stop <span className="tag">optional</span>
          </div>
          <p>
            <a href={mapsLink(stop.poi.lat, stop.poi.lng)} target="_blank" rel="noopener noreferrer">
              <b>{stop.poi.name}</b>
            </a>{" "}
            · {u.marker(stop.mile)} · ≈ {fmtTime(stop.eta)} · {stop.len} min
          </p>
        </div>
      )}
      <div className="btnrow" style={{ marginTop: 12 }}>
        <a className="btn btn-primary btn-sm" href={route.url} target="_blank" rel="noopener noreferrer">
          Open in RWGPS
        </a>
      </div>
    </Panel>
  );

  let weather: ReactNode;
  if (mode === "past") {
    const o = props.ride.observed;
    weather = o ? (
      <Panel
        id="weather"
        label="Weather"
        summary={
          <>
            <b>{u.temp(o.T)}</b> · feels {u.temp(o.app)} · wind {u.speed(o.ws)} ·{" "}
            {o.rain ? `${u.rain(o.rain)} rain` : "no rain"} · roads {o.road.toLowerCase()}
            <div className="tiny muted">Recorded at roll-out</div>
          </>
        }
      >
        <p className="small" style={{ margin: 0 }}>
          <WxIcon code={o.code} />
          {wxLabel(o.code)} · {u.temp(o.T)} (real feel {u.temp(o.app)}, bike feel{" "}
          {u.temp(bikeFeel(o.T, o.ws, o.app, ride.pace))}) · wind {u.speed(o.ws)} {u.speedUnit}, gusts {u.speed(o.wg)} ·{" "}
          {o.rain ? `${u.rain(o.rain)} rain in the ${s.lookback} h before` : "no rain"} · roads {o.road.toLowerCase()}
        </p>
        <p className="tiny muted" style={{ margin: "6px 0 0" }}>
          From Open-Meteo's record of the past hours at the spot.
        </p>
      </Panel>
    ) : (
      <EmptyPanel label="Weather" text="No weather was recorded for this ride." />
    );
  } else if (st && ev && se && m.kit) {
    weather = (
      <Panel
        id={`${kp}weather`}
        label="Weather"
        summary={
          <>
            {wxSummary(st, u)}
            <div className="tiny muted">
              Wear: {m.kit.band.name.toLowerCase()} kit
              {m.kit.addOns.length ? ` + ${m.kit.addOns.map((a) => ADD_ON_TEXT(a, u).short).join(", ")}` : ""}
            </div>
          </>
        }
      >
        <p className="small" style={{ margin: 0 }}>
          Ride {fmtTime(t.start)}–{fmtTime(t.end)} · bike feel {u.temp(st.feelMin)}–{u.temp(st.feelMax)} · gusts{" "}
          {u.speed(st.wgMax)} {u.speedUnit} from {compass(st.dir)} · {u.rain(st.rain)} rain ·{" "}
          {roadNote(st, u, s.lookback)}
        </p>
        <HourTable se={se} ev={ev} pace={ride.pace} s={s} u={u} />
        <WeatherAppRow spot={spot} />
        <WhatToWear kit={m.kit} feelMin={st.feelMin} u={u} />
      </Panel>
    );
  } else {
    weather = <EmptyPanel label="Weather" text="Forecast not available for this date yet." />;
  }

  const notes = ride.notes ? (
    <Panel id={`${kp}notes`} label="Notes" summary={<span className="clamp">{ride.notes.split("\n")[0]}</span>}>
      <p className="notes">{ride.notes}</p>
    </Panel>
  ) : null;

  return (
    <>
      {mode !== "past" && <WarningBoxes list={m.warnings} u={u} lookback={s.lookback} />}
      <div className="panels">
        {meet}
        {routePanel}
        {weather}
        {notes}
        {props.riders}
      </div>
    </>
  );
}
