// Activity page parts (DESIGN.md → Rides, v2): header card, action row (Directions · Calendar · Share · RideWithGPS),
// warnings and the Meet / Route / Weather / Notes panels. Used by the activity page (upcoming and past) and Plan's preview.

import { lazy, type ReactNode, Suspense, useState } from "react";
import rwgpsLogo from "../../brand/web/ridewithgps-vertical-logo.svg";
import { type ActivityDetail, activityName, type RecordedWeather } from "../../shared/api.ts";
import { activityEvent } from "../../shared/ics.ts";
import { KIT_OFFSETS, type KitAdvice, type KitOffset } from "../../shared/kit.ts";
import { M_PER_MI, mapsLink, type Spot } from "../../shared/ride.ts";
import { hasRoute, INDOOR_LABELS, SPORT_LABEL, type Sport } from "../../shared/sports.ts";
import { dayLabel, fmtDur, fmtTime } from "../../shared/time.ts";
import { bikeFeel, compass } from "../../shared/weather.ts";
import type { ActivityLike, ActivityModel } from "../lib/activityModel.ts";
import { type CalEvent, downloadIcs, googleLink, outlookLink } from "../lib/calendar.ts";
import { bbt, isApp } from "../lib/native.ts";
import { type Prefs, setPref, usePrefs } from "../lib/prefs.ts";
import { type Units, units } from "../lib/units.ts";
import { CalendarLink } from "./CalendarLink.tsx";
import { ElevationChart } from "./charts.tsx";
import { HourTable } from "./HourTable.tsx";
import { CalendarIcon, DirectionsIcon, EditIcon, ShareIcon, SportIcon, WxIcon, wxLabel } from "./icons.tsx";
import { Linkified } from "./Linkified.tsx";
import { EmptyPanel, Panel } from "./Panel.tsx";
import { Sheet } from "./Sheet.tsx";
import { WarningBoxes } from "./Warnings.tsx";

// The map library is large; load it only when a Route panel opens.
const RouteMap = lazy(() => import("./RouteMap.tsx").then((m) => ({ default: m.RouteMap })));

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

export const wxSummary = (st: NonNullable<ActivityModel["ev"]>["st"], u: Units) => (
  <>
    <b>
      {u.temp(st.tMin)}–{u.temp(st.tMax)}
    </b>{" "}
    · feels {u.temp(st.appMin)}–{u.temp(st.appMax)} · wind {u.speed(st.wsMax)} · rain {Math.round(st.ppMax)}%
  </>
);

export const roadNote = (st: NonNullable<ActivityModel["ev"]>["st"], u: Units, lookback: number) =>
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
        why: `roads ${a.road.toLowerCase()} at meet time`,
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

/** The feel people care about on the move: bike feel for rides, run feel for runs (none for other sports). */
const feelLabel = (sport: Sport): string | undefined =>
  sport === "ride" ? "bike feel" : sport === "run" ? "run feel" : undefined;

/** "Ride · Outdoor" / "Swim · Pool": the sport, plus the setting for sports that can be indoors. */
function sportLine(a: Pick<ActivityLike, "sport" | "outdoor">): string {
  const labels = INDOOR_LABELS[a.sport];
  return labels ? `${SPORT_LABEL[a.sport]} · ${a.outdoor ? labels[1] : labels[0]}` : SPORT_LABEL[a.sport];
}

/** Header card: sport, name, day and time, details; the Edit pencil for editors. */
export function ActivityHeader({ act, m, onEdit }: { act: ActivityLike; m: ActivityModel; onEdit?: () => void }) {
  const name = activityName(act);
  return (
    <section className="panel ahead">
      <span className="ahead-icon">
        <SportIcon sport={act.sport} icon={act.icon} size={30} />
      </span>
      <div className="ahead-b">
        <span className="kicker">{sportLine(act)}</span>
        <h1>{name}</h1>
        <span className="small muted">
          {dayLabel(act.date, true)} · {fmtTime(m.start)}
          {hasRoute(act.sport) ? "" : `–${fmtTime(m.end)}`}
          {act.details ? ` · ${act.details}` : ""}
        </span>
      </div>
      {onEdit && (
        <button type="button" className="iconbtn edit" aria-label="Edit" title="Edit" onClick={onEdit}>
          <EditIcon />
        </button>
      )}
    </section>
  );
}

function shareText(act: ActivityDetail, m: ActivityModel, u: Units): string {
  const st = m.ev?.st;
  const routed = hasRoute(act.sport);
  const lines = [
    `${act.status === "cancelled" ? "CANCELLED: " : ""}BBT ${SPORT_LABEL[act.sport].toLowerCase()} · ${dayLabel(act.date, true)}`,
    act.title || null,
    `${routed ? "Meet" : "Starts"} ${fmtTime(m.start)} · ${m.spot.name} ${m.spot.maps_url}`,
    ...act.routes.map((r) => {
      const rr = m.routeById(r.routeId);
      const name = rr ? `${rr.name} (${u.dist(rr.distance_m / M_PER_MI)}) ${rr.url}` : `#${r.routeId}`;
      return `${act.routes.length > 1 ? `${r.label}: ` : "Route: "}${name}`;
    }),
    m.ride?.stop ? `Coffee: ${m.ride.stop.poi.name} ≈ ${fmtTime(m.ride.stop.eta)} (optional)` : null,
    routed ? `Back ≈ ${fmtTime(m.end)}` : `Until ${fmtTime(m.end)}`,
    act.details || null,
    st
      ? `Weather: ${u.temp(st.tMin)}–${u.temp(st.tMax)}, feels ${u.temp(st.appMin)}–${u.temp(st.appMax)}, wind ${u.speed(st.wsMax)} ${u.speedUnit}, rain ${Math.round(st.ppMax)}%${m.rules.road && st.road.state !== "Dry" ? `, roads ${st.road.state.toLowerCase()}` : ""}`
      : null,
    act.notes ? `Notes: ${act.notes.replace(/\n/g, " ")}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

function CopySheet({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Sheet label="Share" onClose={onClose}>
      <h2>Share</h2>
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

function CalendarSheet({ ev, onClose }: { ev: CalEvent; onClose: () => void }) {
  const ics = () => {
    downloadIcs(ev);
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
        {!isApp() && ( // the app's WebView can't download files
          <button type="button" onClick={ics}>
            Apple Calendar <span>.ics file</span>
          </button>
        )}
        <a href={outlookLink(ev, "outlook.live.com")} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          Outlook.com
        </a>
        <a href={outlookLink(ev, "outlook.office.com")} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          Outlook (work or school)
        </a>
        {!isApp() && (
          <button type="button" onClick={ics}>
            Other <span>.ics file</span>
          </button>
        )}
      </div>
      <div className="sub">
        <div className="sub-h">Or subscribe to your BBT calendar</div>
        <p className="small muted" style={{ margin: "0 0 8px" }}>
          Everything you're in for, kept up to date: changes and cancellations update it by themselves.
        </p>
        <CalendarLink />
      </div>
      <div className="btnrow" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-outline" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

function DirectionsSheet({ spot, onClose }: { spot: Spot; onClose: () => void }) {
  const at = `${spot.lat},${spot.lng}`;
  const apps = [
    ["Google Maps", `https://www.google.com/maps/dir/?api=1&destination=${at}`],
    ["Apple Maps", `https://maps.apple.com/?daddr=${at}`],
    ["Waze", `https://waze.com/ul?ll=${at}&navigate=yes`],
  ];
  return (
    <Sheet label="Directions" onClose={onClose}>
      <h2>Directions</h2>
      <p className="small muted" style={{ margin: "4px 0 10px" }}>
        To {spot.name}
      </p>
      <div className="choices">
        {apps.map(([name, href]) => (
          <a key={name} href={href} target="_blank" rel="noopener noreferrer" onClick={onClose}>
            {name}
          </a>
        ))}
      </div>
      <div className="btnrow" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-outline" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/** The activity as a calendar event (the same one the calendar link carries). */
const calendarEvent = (act: ActivityDetail, m: ActivityModel): CalEvent =>
  activityEvent({
    id: act.id,
    sport: SPORT_LABEL[act.sport].toLowerCase(),
    name: activityName(act),
    date: act.date,
    start: m.start,
    end: m.end,
    meet: hasRoute(act.sport),
    spot: m.spot,
    routes: act.routes.map((r) => {
      const route = m.routeById(r.routeId);
      return { label: r.label, name: route?.name ?? `#${r.routeId}`, url: route?.url ?? "" };
    }),
    details: act.details,
    notes: act.notes,
  });

/** Every way to leave the app, in the same place and order on every activity (DESIGN.md → v2, Action row). */
export function ActionRow({ act, m }: { act: ActivityDetail; m: ActivityModel }) {
  const [sheet, setSheet] = useState<"directions" | "calendar" | null>(null);
  const [copy, setCopy] = useState<string | null>(null);
  const u = units(usePrefs().units);
  const share = () => {
    const text = shareText(act, m, u);
    const url = `${location.origin}/a/${act.id}`;
    if (isApp()) bbt.share({ title: `BBT · ${activityName(act)}`, text, url }).catch(() => undefined);
    else if (navigator.share)
      navigator.share({ title: `BBT · ${activityName(act)}`, text, url }).catch(() => undefined);
    else setCopy(`${text}\n${url}`);
  };
  return (
    <>
      <div className="tiles">
        <button type="button" className="tile" onClick={() => setSheet("directions")}>
          <DirectionsIcon />
          Directions
        </button>
        <button type="button" className="tile" onClick={() => setSheet("calendar")}>
          <CalendarIcon />
          Calendar
        </button>
        <button type="button" className="tile" onClick={share}>
          <ShareIcon />
          Share
        </button>
        {m.route && <RwgpsTile url={m.route.url} />}
      </div>
      {sheet === "directions" && <DirectionsSheet spot={m.spot} onClose={() => setSheet(null)} />}
      {sheet === "calendar" && <CalendarSheet ev={calendarEvent(act, m)} onClose={() => setSheet(null)} />}
      {copy && <CopySheet text={copy} onClose={() => setCopy(null)} />}
    </>
  );
}

/** Open in RideWithGPS: their vertical logo, which already carries the name. */
export const RwgpsTile = ({ url }: { url: string }) => (
  <a className="tile" href={url} target="_blank" rel="noopener noreferrer" aria-label="Open in RideWithGPS">
    <img src={rwgpsLogo} alt="" width={40} height={47} />
  </a>
);

export function ActivityBody(props: {
  act: ActivityLike & { id?: string; observed?: RecordedWeather | null };
  model: ActivityModel;
  mode: "upcoming" | "past" | "preview";
  routeIndex: number;
  onRouteIndex?: (i: number) => void;
  people?: ReactNode;
  history?: ReactNode; // the quiet History panel, last
}) {
  const { act, model: m, mode } = props;
  const u = units(usePrefs().units);
  const kp = mode === "preview" ? "pv-" : "";
  const { ride, spot, route, ev, se, settings: s, rules } = m;
  const st = ev?.st;
  const stop = ride?.stop ?? null;
  const routed = hasRoute(act.sport);
  const feel = feelLabel(act.sport);

  const meet = (
    <Panel
      id={`${kp}meet`}
      label="Meet"
      summary={
        <>
          <b>{fmtTime(m.start)}</b> · {spot.name}
        </>
      }
    >
      <dl className="kvlist">
        <div>
          <dt>{routed ? "Back" : "Until"}</dt>
          <dd>
            <b>
              {routed ? "≈ " : ""}
              {fmtTime(m.end)}
            </b>
            {ride && (
              <span>
                {fmtDur(ride.movingH)} moving + {Math.round(ride.regroupMin)} min regroups
                {stop ? ` + ${stop.len} min coffee · ≈ ${fmtTime(m.end - stop.len)} without the stop` : ""}
              </span>
            )}
          </dd>
        </div>
        {spot.note && (
          <div>
            <dt>Notes</dt>
            <dd>{spot.note}</dd>
          </div>
        )}
      </dl>
    </Panel>
  );

  const switcher =
    mode !== "preview" && act.routes.length > 1 ? (
      <div className="seg" role="group" aria-label="Route">
        {act.routes.map((r, i) => {
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

  const routePanel =
    route && ride ? (
      <Panel
        id={`${kp}route`}
        label="Route"
        summary={
          <>
            <b>{route.name}</b> · {u.dist(ride.distMi)} · {u.elev(ride.climbFt)}
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
      </Panel>
    ) : null;

  let weather: ReactNode = null;
  if (!act.outdoor) weather = null;
  else if (mode === "past") {
    const o = props.act.observed;
    weather = o ? (
      <Panel
        id="weather"
        label="Weather"
        summary={
          <>
            <b>{u.temp(o.T)}</b> · feels {u.temp(o.app)} · wind {u.speed(o.ws)} ·{" "}
            {o.rain ? `${u.rain(o.rain)} rain` : "no rain"}
            {rules.road ? ` · roads ${o.road.toLowerCase()}` : ""}
            <div className="tiny muted">Recorded at the start</div>
          </>
        }
      >
        <p className="small" style={{ margin: 0 }}>
          <WxIcon code={o.code} />
          {wxLabel(o.code)} · {u.temp(o.T)} (real feel {u.temp(o.app)}
          {feel ? `, ${feel} ${u.temp(bikeFeel(o.T, o.ws, o.app, rules.pace))}` : ""}) · wind {u.speed(o.ws)}{" "}
          {u.speedUnit}, gusts {u.speed(o.wg)} ·{" "}
          {o.rain ? `${u.rain(o.rain)} rain in the ${s.lookback} h before` : "no rain"}
          {rules.road ? ` · roads ${o.road.toLowerCase()}` : ""}
        </p>
        <p className="tiny muted" style={{ margin: "6px 0 0" }}>
          From Open-Meteo's record of the past hours at the place.
        </p>
      </Panel>
    ) : (
      <EmptyPanel label="Weather" text="No weather was recorded." />
    );
  } else if (st && ev && se) {
    weather = (
      <Panel
        id={`${kp}weather`}
        label="Weather"
        summary={
          <>
            {wxSummary(st, u)}
            {m.kit && (
              <div className="tiny muted">
                Wear: {m.kit.band.name.toLowerCase()} kit
                {m.kit.addOns.length ? ` + ${m.kit.addOns.map((a) => ADD_ON_TEXT(a, u).short).join(", ")}` : ""}
              </div>
            )}
          </>
        }
      >
        <p className="small" style={{ margin: 0 }}>
          {fmtTime(m.start)}–{fmtTime(m.end)}
          {feel ? ` · ${feel} ${u.temp(st.feelMin)}–${u.temp(st.feelMax)}` : ""} · gusts {u.speed(st.wgMax)}{" "}
          {u.speedUnit} from {compass(st.dir)} · {u.rain(st.rain)} rain
          {rules.road ? ` · ${roadNote(st, u, s.lookback)}` : ""}
        </p>
        <HourTable se={se} ev={ev} rules={rules} feel={feel && (act.sport === "ride" ? "Bike" : "Run")} s={s} u={u} />
        <WeatherAppRow spot={spot} />
        {m.kit && <WhatToWear kit={m.kit} feelMin={st.feelMin} u={u} />}
      </Panel>
    );
  } else {
    weather = <EmptyPanel label="Weather" text="Forecast not available for this date yet." />;
  }

  const notes = act.notes ? (
    <Panel id={`${kp}notes`} label="Notes" summary={<span className="clamp">{act.notes.split("\n")[0]}</span>}>
      <p className="notes">
        <Linkified text={act.notes} />
      </p>
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
        {props.people}
        {props.history}
      </div>
    </>
  );
}
