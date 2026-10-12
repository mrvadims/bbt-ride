// Plan a ride (Edit and Admin): Meet (date, time, start spot) → Route → Notes → Preview → Publish (DESIGN.md → Plan a ride).
// The form autosaves as a per-editor draft on the server; there is no Save draft button.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RideDetail, RideUpdate, RouteSummary } from "../../shared/api.ts";
import { etaAt, FT_PER_M, M_PER_MI, nearest, type Poi, rideTimes, startDistance } from "../../shared/ride.ts";
import { addDays, dayLabel, fmtTime, hhmmToMin, isDate, isWeekend, nyNow, weekendDates } from "../../shared/time.ts";
import { evaluate, warnings } from "../../shared/weather.ts";
import { RainBars } from "../components/charts.tsx";
import { DatePicker } from "../components/DatePicker.tsx";
import { HourTable } from "../components/HourTable.tsx";
import { EmptyPanel, Panel, Section } from "../components/Panel.tsx";
import { RideBody, roadNote, WeatherAppRow, wxSummary } from "../components/RideBody.tsx";
import { SpotForm } from "../components/SpotForm.tsx";
import { WarningChips } from "../components/Warnings.tsx";
import { api } from "../lib/api.ts";
import {
  NO_WEATHER,
  refreshSpots,
  type SpotWithState,
  useRide,
  useRides,
  useRoute,
  useRouteSearch,
  useSpots,
  useTeam,
  useWeather,
} from "../lib/data.ts";
import { usePrefs } from "../lib/prefs.ts";
import { useRideModel } from "../lib/rideModel.ts";
import { navigate, useLocation } from "../lib/router.tsx";
import { units } from "../lib/units.ts";
import { rideOn } from "./RidePage.tsx";

interface Form {
  editing: string | null; // id of the published ride being edited
  base: string | null; // that ride's updatedAt when editing began (the server refuses the update if it changed since)
  date: string;
  time: string;
  spotId: string | null;
  routeId: number | null;
  altOn: boolean;
  altId: number | null;
  labelA: string;
  labelB: string;
  stop: string | null | undefined; // undefined = pick the route's first coffee/food stop automatically
  pace: number;
  notes: string;
  q: string;
  qAlt: string;
}

const isCoffee = (p: Poi) => /coffee|food/.test(p.type);

// Only a full RideWithGPS link selects a route by ID: a bare number would be looked up on every keystroke.
const routeIdFrom = (q: string): number | null => {
  const m = q.match(/ridewithgps\.com\/routes\/(\d+)/);
  return m ? Number(m[1]) : null;
};

function fromRide(r: RideDetail, date: string, editing: string | null, fallbackPace: number): Partial<Form> {
  const [main, alt] = r.routes;
  return {
    editing,
    base: editing ? r.updatedAt : null,
    date,
    time: r.meetTime,
    spotId: r.spotId,
    routeId: main?.routeId ?? null,
    q: main?.name ?? "",
    stop: main?.stop ?? null,
    altOn: Boolean(alt),
    altId: alt?.routeId ?? null,
    qAlt: alt?.name ?? "",
    labelA: alt ? (main?.label ?? "Full") : "Full",
    labelB: alt?.label ?? "Short",
    pace: r.pace || fallbackPace,
    notes: r.notes,
  };
}

function RouteResults({
  q,
  chosen,
  spots,
  spotId,
  onPick,
}: {
  q: string;
  chosen: number | null;
  spots: SpotWithState[];
  spotId: string | null;
  onPick: (r: RouteSummary) => void;
}) {
  const search = useRouteSearch(routeIdFrom(q) ? "" : q.trim());
  const u = units(usePrefs().units);
  const active = spots.filter((s) => !s.archived);
  const startsAt = (r: RouteSummary) => nearest(r.start[0], r.start[1], active);
  const list = [...(search.data ?? [])].sort(
    (a, b) => Number(startsAt(b)?.id === spotId) - Number(startsAt(a)?.id === spotId),
  );
  if (routeIdFrom(q)) return null;
  if (search.data && !list.length)
    return (
      <div className="results">
        <div style={{ padding: 10 }} className="small muted">
          No match in the route library. Paste a RideWithGPS link instead.
        </div>
      </div>
    );
  return (
    <div className="results" role="listbox" aria-label="Routes">
      {list.slice(0, 20).map((r) => {
        const at = startsAt(r);
        return (
          <button key={r.id} type="button" role="option" aria-selected={r.id === chosen} onClick={() => onPick(r)}>
            <span>
              <b>{r.name}</b>
              <br />
              <span className="tiny muted">
                #{r.id} · {at?.id === spotId ? "starts here" : `starts at ${at?.name ?? "?"}`}
              </span>
            </span>
            <span className="small muted">
              {u.dist(r.distance_m / M_PER_MI, 0)} · {u.elev(r.elevation_gain_m * FT_PER_M)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const RwgpsLink = ({ url }: { url: string }) => (
  <a className="tiny rwgps-link" href={url} target="_blank" rel="noopener noreferrer">
    Open in RWGPS ↗
  </a>
);

function AddSpot({ onAdded, onCancel }: { onAdded: (id: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  return (
    <SpotForm
      title="New start spot"
      submitLabel="Save spot"
      onCancel={onCancel}
      onSubmit={async (f) => {
        const spot = await api<SpotWithState>("/spots", { body: f });
        await refreshSpots(qc);
        onAdded(spot.id);
      }}
    />
  );
}

export function PlanPage() {
  const { query } = useLocation();
  const qc = useQueryClient();
  const team = useTeam().data;
  const spots = useSpots().data;
  const wq = useWeather();
  const weather = wq.data ?? NO_WEATHER; // planning never waits on the forecast
  const rides = useRides().data;
  const u = units(usePrefs().units);
  const [form, setForm] = useState<Form | null>(null);
  const [addingSpot, setAddingSpot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editId = query.get("edit");
  const reuseId = query.get("reuse");
  const source = useRide(editId ?? reuseId);
  const sourceRide = source.data;
  const editingRide = useRide(form?.editing).data; // stays current after Cancel / Restore
  const today = nyNow().date;
  const dateQuery = query.get("date"); // from a ride page link
  const dateParam = isDate(dateQuery) && dateQuery >= today ? dateQuery : null;

  // The first weekend day in the coming week with no ride yet; otherwise this Saturday.
  const nextFreeDay = (): string => {
    const [sat] = weekendDates(today);
    for (let d = sat; d <= addDays(today, 7); d = addDays(d, 1)) {
      if (isWeekend(d) && !(rides ?? []).some((r) => r.date === d && r.status === "published")) return d;
    }
    return sat;
  };
  const freshForm = (): Form => ({
    editing: null,
    base: null,
    date: dateParam ?? nextFreeDay(),
    time: team?.settings.meetTime ?? "08:30",
    spotId: null,
    routeId: null,
    altOn: false,
    altId: null,
    labelA: "Full",
    labelB: "Short",
    stop: undefined,
    pace: team?.settings.pace ?? 17,
    notes: "",
    q: "",
    qAlt: "",
  });

  // Load the form once: editing a ride, reusing a past ride, the saved draft, or a fresh plan.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !team || !spots || !rides) return;
    if ((editId || reuseId) && !sourceRide) return;
    loaded.current = true;
    const base = freshForm();
    if (editId && sourceRide)
      return setForm({ ...base, ...fromRide(sourceRide, sourceRide.date, sourceRide.id, team.settings.pace) });
    if (reuseId && sourceRide)
      return setForm({ ...base, ...fromRide(sourceRide, nextFreeDay(), null, team.settings.pace) });
    api<{ form: Partial<Form> } | null>("/draft")
      .then((d) => {
        const restored = { ...base, ...(d?.form ?? {}) };
        if (restored.date < today) Object.assign(restored, { date: base.date, editing: null, base: null }); // stale draft
        if (dateParam) Object.assign(restored, { date: dateParam, editing: null, base: null });
        // Drafts saved before edit conflicts were checked have no base: take the ride as it is now.
        if (restored.editing && !restored.base)
          restored.base = rides.find((r) => r.id === restored.editing)?.updatedAt ?? null;
        setForm(restored);
      })
      .catch(() => setForm(base));
  });

  // Autosave the draft (debounced), but only once the editor changes something: just opening a ride to edit or
  // reuse leaves the saved draft alone. The last save is kept so dropping the draft can wait for it.
  const dirty = useRef(false);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!form || !dirty.current) return;
    const t = setTimeout(() => {
      saving.current = api("/draft", { method: "PUT", body: { form } }).catch(() => undefined);
    }, 800);
    return () => clearTimeout(t);
  }, [form]);
  /** Stops autosave, waits for a save in flight, then deletes the draft this session saved (if any). */
  const dropDraft = async () => {
    const saved = dirty.current;
    dirty.current = false;
    await saving.current;
    if (saved) await api("/draft", { method: "DELETE" }).catch(() => undefined);
  };

  const set = useCallback((patch: Partial<Form>) => {
    dirty.current = true;
    setForm((f) => (f ? { ...f, ...patch } : f));
  }, []);
  const routeQ = useRoute(form?.routeId);
  const altQ = useRoute(form?.altOn ? form.altId : null);
  const pastedMainQ = useRoute(form ? routeIdFrom(form.q) : null);
  const pastedAltQ = useRoute(form ? routeIdFrom(form.qAlt) : null);
  const route = routeQ.data;
  const altRoute = altQ.data;
  const pastedMainRoute = pastedMainQ.data;
  const pastedAltRoute = pastedAltQ.data;
  // A pasted link that doesn't load (private, deleted) or a picked route that fails says why.
  const routeError = (pastedMainQ.error ?? routeQ.error)?.message;
  const altError = (pastedAltQ.error ?? altQ.error)?.message;

  // A pasted RideWithGPS link selects that route once it loads.
  useEffect(() => {
    if (pastedMainRoute && form && form.routeId !== pastedMainRoute.id)
      set({ routeId: pastedMainRoute.id, stop: undefined });
  }, [pastedMainRoute, form, set]);
  useEffect(() => {
    if (pastedAltRoute && form && form.altId !== pastedAltRoute.id) set({ altId: pastedAltRoute.id });
  }, [pastedAltRoute, form, set]);

  // Picking a route first selects the spot it starts from; a new route picks its first coffee/food stop.
  useEffect(() => {
    if (!form || !route || !spots) return;
    const patch: Partial<Form> = {};
    const start = route.track[0];
    const near =
      start &&
      nearest(
        start[0],
        start[1],
        spots.filter((s) => !s.archived),
      );
    if (!form.spotId && near) patch.spotId = near.id;
    if (form.stop === undefined) patch.stop = route.pois.find(isCoffee)?.name ?? null;
    if (Object.keys(patch).length) set(patch);
  }, [route, form, spots, set]);

  const draftRide =
    form?.routeId && form.spotId && route
      ? {
          date: form.date,
          meetTime: form.time,
          spotId: form.spotId,
          pace: form.pace,
          notes: form.notes,
          status: "published" as const,
          routes: [
            {
              label: form.altOn && form.altId ? form.labelA : "Main",
              routeId: form.routeId,
              stop: form.stop ?? null,
              name: route.name,
            },
            ...(form.altOn && form.altId && altRoute
              ? [
                  {
                    label: form.labelB,
                    routeId: form.altId,
                    stop: altRoute.pois.some((p) => p.name === form.stop) ? (form.stop ?? null) : null,
                    name: altRoute.name,
                  },
                ]
              : []),
          ],
        }
      : null;
  const model = useRideModel(draftRide);

  const publish = useMutation({
    mutationFn: async (replace: boolean) => {
      if (!form || !draftRide) throw new Error("Pick a start spot and a route");
      if (form.altOn && form.altId && !altRoute) throw new Error("The alternate route hasn't loaded yet");
      const body: RideUpdate = {
        date: draftRide.date,
        meetTime: draftRide.meetTime,
        spotId: draftRide.spotId,
        pace: draftRide.pace,
        notes: draftRide.notes,
        routes: draftRide.routes.map(({ label, routeId, stop }) => ({ label, routeId, stop })),
        replace,
        baseUpdatedAt: form.base ?? "", // a POST ignores it
      };
      return form.editing
        ? api<RideDetail>(`/rides/${form.editing}`, { method: "PUT", body })
        : api<RideDetail>("/rides", { body });
    },
    onSuccess: async (ride) => {
      await dropDraft(); // the server already deleted it; this catches a save that was in flight
      await qc.invalidateQueries({ queryKey: ["rides"] });
      qc.setQueryData(["ride", ride.id], ride);
      navigate(`/ride/${ride.date}`);
    },
    onError: (e) => setError(e.message),
  });
  const toggleCancel = useMutation({
    mutationFn: (r: RideDetail) =>
      api<RideDetail>(`/rides/${r.id}/${r.status === "cancelled" ? "restore" : "cancel"}`, { method: "POST" }),
    onSuccess: async (ride, r) => {
      qc.setQueryData(["ride", ride.id], ride);
      // Our own Cancel/Restore isn't a conflict, but only if the form was up to date before it.
      setForm((f) => (f?.editing === ride.id && f.base === r.updatedAt ? { ...f, base: ride.updatedAt } : f));
      await qc.invalidateQueries({ queryKey: ["rides"] });
    },
    onError: (e) => setError(e.message),
  });
  const clear = async () => {
    await dropDraft();
    navigate("/plan", true);
    setForm({ ...freshForm(), date: nextFreeDay() });
  };

  if (source.isError) return <p className="small">That ride couldn't be loaded. {source.error.message}</p>;
  if (!form || !team || !spots || !rides) return <p className="muted small">Loading…</p>;
  const s = team.settings;
  const active = spots.filter((x) => !x.archived);
  const weekend = weekendDates(today);
  const startMin = hhmmToMin(form.time);
  const times = route ? rideTimes(route, form.time, form.pace, form.stop ?? null, s) : null;
  const durMin = times ? times.end - times.start : s.durationH * 60;
  const spot = active.find((x) => x.id === form.spotId) ?? spots.find((x) => x.id === form.spotId);
  const clash = rideOn(rides, form.date);
  const clashOther = clash && clash.status === "published" && clash.id !== form.editing ? clash : undefined;
  const pois = route
    ? [...route.pois].sort((a, b) => Number(isCoffee(b)) - Number(isCoffee(a)) || a.route_d_m - b.route_d_m)
    : [];
  const far = route && spot ? startDistance(route, spot) : 0;

  const spotRow = (sp: SpotWithState) => {
    const se = weather.series[sp.id];
    const ev = se ? evaluate(se, form.date, startMin, durMin, form.pace, s) : null;
    return (
      <button
        key={sp.id}
        type="button"
        className="spotrow"
        role="radio"
        data-spot={sp.id}
        aria-checked={form.spotId === sp.id}
        tabIndex={form.spotId === sp.id || (!form.spotId && sp.id === active[0]?.id) ? 0 : -1}
        onClick={() => set({ spotId: sp.id })}
      >
        <span className="radio-dot" aria-hidden="true" />
        <span className="spotrow-b">
          <b>{sp.name}</b>
          <span className="small">
            {ev && se ? (
              <>
                {wxSummary(ev.st, u)}
                <WarningChips
                  list={warnings(ev, se, form.date, startMin, weather.alerts[sp.id] ?? [])}
                  u={u}
                  lookback={s.lookback}
                />
              </>
            ) : (
              <span className="muted">{wq.isPending ? "Loading the forecast…" : "No forecast for this date yet."}</span>
            )}
          </span>
        </span>
      </button>
    );
  };

  const detail = (() => {
    if (!spot) return null;
    const se = weather.series[spot.id];
    const ev = se ? evaluate(se, form.date, startMin, durMin, form.pace, s) : null;
    const radar = `https://www.rainviewer.com/map.html?loc=${spot.lat},${spot.lng},9&oFa=0&oC=1&oU=0&oCS=1&oF=0&oAP=1&c=3&o=83&lm=1&layer=radar&sm=1&sn=1`;
    return (
      <Panel id="spotdetail" label="Details" summary={`${spot.name} · weather, parking`} collapsed>
        {ev && se && (
          <>
            <p className="small" style={{ margin: "0 0 8px" }}>
              Bike feel {u.temp(ev.st.feelMin)}–{u.temp(ev.st.feelMax)} · gusts {u.speed(ev.st.wgMax)} {u.speedUnit} ·{" "}
              {u.rain(ev.st.rain)} rain · {roadNote(ev.st, u, s.lookback)}
            </p>
            <div className="sub-h" style={{ marginTop: 4 }}>
              Rain −12 h → +8 h
            </div>
            <RainBars se={se} date={form.date} startMin={startMin} endMin={startMin + durMin} u={u} />
            <HourTable se={se} ev={ev} pace={form.pace} s={s} u={u} />
          </>
        )}
        <WeatherAppRow
          spot={spot}
          extra={
            <a className="btn btn-outline btn-sm" href={radar} target="_blank" rel="noopener noreferrer">
              Radar
            </a>
          }
        />
        <div className="sub">
          <div className="sub-h">Parking</div>
          <p>{spot.note || "No notes yet."}</p>
          <div className="btnrow">
            <a className="btn btn-outline btn-sm" href={spot.maps_url} target="_blank" rel="noopener noreferrer">
              Open in Google Maps
            </a>
          </div>
        </div>
      </Panel>
    );
  })();

  return (
    <>
      <h1 className="sr">Plan a ride</h1>
      {editingRide ? (
        <div className={`editbar${editingRide.status === "cancelled" ? " lv2" : ""}`}>
          <span>
            <b>Editing the {dayLabel(editingRide.date)} ride</b>
            {editingRide.status === "cancelled" ? " · cancelled" : ""}
          </span>
          <button type="button" className="linkbtn" onClick={clear}>
            Discard changes
          </button>
        </div>
      ) : (
        <p className="tiny muted" style={{ margin: "-4px 0 10px" }}>
          Draft saves automatically.{" "}
          <button type="button" className="linkbtn" onClick={clear}>
            Start over
          </button>
        </p>
      )}
      <div className="plan-grid">
        <div className="panels">
          <Section label="Meet">
            <div className="daytabs" role="group" aria-label="Weekend day">
              {weekend.map((d) => (
                <button
                  key={d}
                  className="tab"
                  type="button"
                  aria-pressed={d === form.date}
                  onClick={() => set({ date: d })}
                >
                  {dayLabel(d)}
                </button>
              ))}
            </div>
            <div className="row">
              <DatePicker label="Date (any day)" value={form.date} min={today} onChange={(date) => set({ date })} />
              <label className="field">
                Meet time
                <input
                  type="time"
                  value={form.time}
                  step={900}
                  onChange={(e) => set({ time: e.target.value || s.meetTime })}
                />
              </label>
            </div>
            <div className="field" style={{ marginBottom: -4 }}>
              Start spot · weather {fmtTime(startMin)}–{fmtTime(startMin + durMin)}
            </div>
            <div className="spotlist">
              <div
                className="spotgroup"
                role="radiogroup"
                aria-label="Start spot"
                onKeyDown={(e) => {
                  if (!["ArrowDown", "ArrowUp"].includes(e.key) || !active.length) return;
                  e.preventDefault();
                  const i = active.findIndex((x) => x.id === form.spotId);
                  const step = e.key === "ArrowDown" ? 1 : -1;
                  const next = active[
                    i < 0 ? (step > 0 ? 0 : active.length - 1) : (i + step + active.length) % active.length
                  ] as SpotWithState;
                  set({ spotId: next.id });
                  (e.currentTarget.querySelector(`[data-spot="${next.id}"]`) as HTMLElement | null)?.focus();
                }}
              >
                {active.map(spotRow)}
              </div>
              {addingSpot ? (
                <AddSpot
                  onAdded={(id) => {
                    setAddingSpot(false);
                    set({ spotId: id });
                  }}
                  onCancel={() => setAddingSpot(false)}
                />
              ) : (
                <button type="button" className="spotrow add" onClick={() => setAddingSpot(true)}>
                  <span className="radio-dot plus" aria-hidden="true">
                    +
                  </span>
                  <span className="spotrow-b">
                    <b>Add a start spot</b>
                  </span>
                </button>
              )}
            </div>
            {detail}
          </Section>

          <Section label="Route">
            <div className="fieldbox">
              <label className="field">
                {spot
                  ? `Routes from ${spot.name}, or search / paste a RideWithGPS link`
                  : "Search or paste a RideWithGPS link"}
                <input
                  type="search"
                  value={form.q}
                  placeholder="e.g. Katonah or ridewithgps.com/routes/57406828"
                  autoComplete="off"
                  onChange={(e) => set({ q: e.target.value })}
                />
              </label>
              <RouteResults
                q={form.q}
                chosen={form.routeId}
                spots={spots}
                spotId={form.spotId}
                onPick={(r) => set({ routeId: r.id, q: r.name, stop: undefined })}
              />
            </div>
            {routeError ? (
              <p className="tiny" role="alert" style={{ margin: 0, color: "var(--no-fg)" }}>
                {routeError}
              </p>
            ) : (
              route && <RwgpsLink url={route.url} />
            )}
            {far > 0.3 * M_PER_MI && spot && (
              <p className="tiny" style={{ margin: 0, color: "var(--cau-fg)" }}>
                This route starts {u.dist(far / M_PER_MI)} from {spot.name}.
              </p>
            )}
            <label className="radio" style={{ border: 0, padding: 0 }}>
              <input type="checkbox" checked={form.altOn} onChange={(e) => set({ altOn: e.target.checked })} />
              <span>
                <b>Add alternate route</b>
                <br />
                <span className="small muted">Same spot and time</span>
              </span>
            </label>
            {form.altOn && (
              <>
                <div className="row">
                  <label className="field">
                    Main label
                    <input value={form.labelA} maxLength={30} onChange={(e) => set({ labelA: e.target.value })} />
                  </label>
                  <label className="field">
                    Alternate label
                    <input value={form.labelB} maxLength={30} onChange={(e) => set({ labelB: e.target.value })} />
                  </label>
                </div>
                <div className="fieldbox">
                  <label className="field">
                    Alternate route
                    <input
                      type="search"
                      value={form.qAlt}
                      placeholder="Search or paste link"
                      autoComplete="off"
                      onChange={(e) => set({ qAlt: e.target.value })}
                    />
                  </label>
                  <RouteResults
                    q={form.qAlt}
                    chosen={form.altId}
                    spots={spots}
                    spotId={form.spotId}
                    onPick={(r) => set({ altId: r.id, qAlt: r.name })}
                  />
                </div>
                {altError ? (
                  <p className="tiny" role="alert" style={{ margin: 0, color: "var(--no-fg)" }}>
                    {altError}
                  </p>
                ) : (
                  altRoute && <RwgpsLink url={altRoute.url} />
                )}
              </>
            )}
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field" style={{ marginBottom: 4 }}>
                Coffee stop
              </legend>
              {route ? (
                <>
                  {pois.map((p) => (
                    <label key={p.name} className="radio">
                      <input
                        type="radio"
                        name="stop"
                        checked={form.stop === p.name}
                        onChange={() => set({ stop: p.name })}
                      />
                      <span>
                        <b>{p.name}</b> <span className="tag">{p.type}</span>
                        <br />
                        <span className="small muted">
                          {u.marker(p.route_d_m / M_PER_MI)} · ≈{" "}
                          {fmtTime(etaAt(p.route_d_m / M_PER_MI, startMin, form.pace, s))}
                          {p.off_route_m > 50 ? ` · ${u.short(p.off_route_m)} off route` : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                  <label className="radio">
                    <input type="radio" name="stop" checked={!form.stop} onChange={() => set({ stop: null })} />
                    <span>
                      <b>No stop</b>
                    </span>
                  </label>
                </>
              ) : (
                <span className="small muted">Pick a route first.</span>
              )}
            </fieldset>
            <div className="row">
              <label className="field">
                Pace (mph)
                <input
                  type="number"
                  min={10}
                  max={25}
                  step={0.5}
                  defaultValue={form.pace}
                  key={form.pace}
                  onBlur={(e) => set({ pace: Math.min(25, Math.max(10, Number(e.target.value) || s.pace)) })}
                />
              </label>
              <span />
            </div>
          </Section>

          <Section label="Notes">
            <textarea
              aria-label="Notes"
              placeholder="Regroup points, café plan, lights…"
              value={form.notes}
              maxLength={4000}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </Section>
        </div>

        <div>
          <div className="kicker" style={{ margin: "4px 0 8px" }}>
            Preview · {dayLabel(form.date, true)}
          </div>
          {!draftRide || !model || model.loading ? (
            <EmptyPanel
              label="Preview"
              text={
                form.spotId ? "Pick a route to see the preview." : "Pick a start spot and a route to see the preview."
              }
            />
          ) : (
            <>
              <RideBody ride={draftRide} model={model} mode="preview" routeIndex={0} />
              {clashOther && (
                <p className="tiny" style={{ margin: "12px 0 0", color: "var(--cau-fg)" }}>
                  A ride is already posted for {dayLabel(form.date)}. {form.editing ? "Updating" : "Publishing"}{" "}
                  replaces it (the old ride is cancelled and kept in history).
                </p>
              )}
              {error && (
                <p className="small" role="alert" style={{ color: "var(--no-fg)" }}>
                  {error}
                </p>
              )}
              <div className="btnrow" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={publish.isPending}
                  onClick={() => publish.mutate(Boolean(clashOther))}
                >
                  {form.editing ? "Update ride" : clashOther ? "Replace ride" : "Publish"}
                </button>
                {editingRide && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={toggleCancel.isPending}
                    onClick={() => toggleCancel.mutate(editingRide)}
                  >
                    {editingRide.status === "cancelled" ? "Restore ride" : "Cancel ride"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
