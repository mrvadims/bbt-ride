// Plan a ride (Edit and Admin): Meet (date, time, start spot) → Route → Notes → Preview → Publish (DESIGN.md → Plan a ride).
// The form autosaves as a per-editor draft on the server; there is no Save draft button.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RideDetail, RideInput, RouteSummary } from "../../shared/api.ts";
import { etaAt, haversine, M_PER_MI, parseLatLng, rideTimes, startDistance } from "../../shared/ride.ts";
import { addDays, dayLabel, fmtTime, hhmmToMin, isWeekend, nyNow, weekendDates } from "../../shared/time.ts";
import { evaluate, fIdx, warnings } from "../../shared/weather.ts";
import { RainBars } from "../components/charts.tsx";
import { HourTable } from "../components/HourTable.tsx";
import { EmptyPanel, Panel, Section } from "../components/Panel.tsx";
import { RideBody, roadNote, WeatherAppRow, wxSummary } from "../components/RideBody.tsx";
import { WarningChips } from "../components/Warnings.tsx";
import { api } from "../lib/api.ts";
import {
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

const routeIdFrom = (q: string): number | null => {
  const m = q.match(/ridewithgps\.com\/routes\/(\d+)/) ?? q.trim().match(/^(\d{5,})$/);
  return m ? Number(m[1]) : null;
};

function fromRide(r: RideDetail, date: string, editing: string | null, fallbackPace: number): Partial<Form> {
  const [main, alt] = r.routes;
  return {
    editing,
    date,
    time: r.rollout,
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
  const startsAt = (r: RouteSummary) =>
    spots
      .filter((s) => !s.archived)
      .reduce<SpotWithState | null>((best, s) => {
        const d = haversine(r.start[0], r.start[1], s.lat, s.lng);
        return !best || d < haversine(r.start[0], r.start[1], best.lat, best.lng) ? s : best;
      }, null);
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
              {u.dist(r.distance_m / M_PER_MI, 0)} · {u.elev(r.elevation_gain_m * 3.28084)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AddSpot({ onAdded, onCancel }: { onAdded: (id: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", link: "", note: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      let link = f.link.trim();
      if (!parseLatLng(link) && /^https:\/\/maps\.app\.goo\.gl\//.test(link)) {
        const r = await api<{ lat: number; lng: number; url: string }>("/spots/resolve", { body: { url: link } });
        link = `${r.lat}, ${r.lng}`;
      }
      return api<SpotWithState>("/spots", { body: { name: f.name, link, note: f.note } });
    },
    onSuccess: async (spot) => {
      await qc.invalidateQueries({ queryKey: ["spots"] });
      await qc.invalidateQueries({ queryKey: ["weather"] });
      onAdded(spot.id);
    },
    onError: (e) => setMsg(e.message),
  });
  return (
    <div className="newspot">
      <div className="sub-h">New start spot</div>
      <label className="field">
        Name
        <input
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="e.g. Rockefeller Preserve"
          maxLength={80}
        />
      </label>
      <label className="field">
        Google Maps link or coordinates
        <input
          value={f.link}
          onChange={(e) => setF({ ...f, link: e.target.value })}
          placeholder="Paste a Maps link, or 41.0454, -73.6973"
        />
      </label>
      <span className="tiny muted" style={{ marginTop: -8 }}>
        {msg ?? "In Google Maps: drop a pin on the parking spot → Share → Copy link."}
      </span>
      <label className="field">
        Parking notes
        <textarea
          value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })}
          placeholder="Where to park, restrooms, anything riders should know"
          maxLength={1000}
        />
      </label>
      <div className="btnrow">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!f.name.trim() || !f.link.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          Save spot
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function PlanPage() {
  const { query } = useLocation();
  const qc = useQueryClient();
  const team = useTeam().data;
  const spots = useSpots().data;
  const weather = useWeather().data;
  const rides = useRides().data;
  const u = units(usePrefs().units);
  const [form, setForm] = useState<Form | null>(null);
  const [addingSpot, setAddingSpot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editId = query.get("edit");
  const reuseId = query.get("reuse");
  const sourceRide = useRide(editId ?? reuseId).data;
  const editingRide = useRide(form?.editing).data; // stays current after Cancel / Restore
  const today = nyNow().date;

  // First weekend day the forecast covers that has no ride yet; otherwise this Saturday.
  const nextFreeDay = (): string => {
    const se = weather && spots?.[0] ? weather.series[spots[0].id] : undefined;
    const [sat] = weekendDates(today);
    for (let d = sat; se && fIdx(se, d, 0) != null; d = addDays(d, 1)) {
      if (isWeekend(d) && !(rides ?? []).some((r) => r.date === d && r.status === "published")) return d;
    }
    return sat;
  };

  // Load the form once: editing a ride, reusing a past ride, the saved draft, or a fresh plan.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !team || !spots || !rides || !weather) return;
    if ((editId || reuseId) && !sourceRide) return;
    loaded.current = true;
    const base: Form = {
      editing: null,
      date: query.get("date") ?? nextFreeDay(),
      time: team.settings.rollout,
      spotId: null,
      routeId: null,
      altOn: false,
      altId: null,
      labelA: "Full",
      labelB: "Short",
      stop: undefined,
      pace: team.settings.pace,
      notes: "",
      q: "",
      qAlt: "",
    };
    if (editId && sourceRide)
      return setForm({ ...base, ...fromRide(sourceRide, sourceRide.date, sourceRide.id, team.settings.pace) });
    if (reuseId && sourceRide)
      return setForm({ ...base, ...fromRide(sourceRide, nextFreeDay(), null, team.settings.pace) });
    api<{ rideId: string | null; form: Partial<Form> } | null>("/draft")
      .then((d) => {
        const restored = { ...base, ...(d?.form ?? {}) };
        if (restored.date < today) restored.date = base.date; // stale draft
        if (query.get("date")) Object.assign(restored, { date: query.get("date"), editing: null });
        setForm(restored);
      })
      .catch(() => setForm(base));
  });

  // Autosave the draft (debounced). The last save is kept so dropping the draft can wait for it.
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!form) return;
    const t = setTimeout(() => {
      saving.current = api("/draft", { method: "PUT", body: { rideId: form.editing, form } }).catch(() => undefined);
    }, 800);
    return () => clearTimeout(t);
  }, [form]);
  /** Stops autosave (clearing the form cancels the pending timer), waits for a save in flight, then deletes the draft. */
  const dropDraft = async () => {
    setForm(null);
    await saving.current;
    await api("/draft", { method: "DELETE" });
  };

  const set = useCallback((patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f)), []);
  const route = useRoute(form?.routeId).data;
  const altRoute = useRoute(form?.altOn ? form.altId : null).data;
  const pastedMain = form ? routeIdFrom(form.q) : null;
  const pastedAlt = form ? routeIdFrom(form.qAlt) : null;
  const pastedMainRoute = useRoute(pastedMain).data;
  const pastedAltRoute = useRoute(pastedAlt).data;

  // A pasted link or ID selects that route once it loads.
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
    const active = spots.filter((s) => !s.archived);
    if (!form.spotId && active.length) {
      patch.spotId = active.reduce(
        (a, b) => (startDistance(route, b) < startDistance(route, a) ? b : a),
        active[0] as SpotWithState,
      ).id;
    }
    if (form.stop === undefined) patch.stop = route.pois.find((p) => /coffee|food/.test(p.type))?.name ?? null;
    if (Object.keys(patch).length) set(patch);
  }, [route, form, spots, set]);

  const draftRide =
    form?.routeId && form.spotId && route
      ? {
          date: form.date,
          rollout: form.time,
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
      const body: RideInput = {
        date: draftRide.date,
        rollout: draftRide.rollout,
        spotId: draftRide.spotId,
        pace: draftRide.pace,
        notes: draftRide.notes,
        routes: draftRide.routes.map(({ label, routeId, stop }) => ({ label, routeId, stop })),
        replace,
      };
      return form.editing
        ? api<RideDetail>(`/rides/${form.editing}`, { method: "PUT", body })
        : api<RideDetail>("/rides", { body });
    },
    onSuccess: async (ride) => {
      await dropDraft();
      await qc.invalidateQueries({ queryKey: ["rides"] });
      qc.setQueryData(["ride", ride.id], ride);
      navigate(`/ride/${ride.date}`);
    },
    onError: (e) => setError(e.message),
  });
  const toggleCancel = useMutation({
    mutationFn: (r: RideDetail) =>
      api<RideDetail>(`/rides/${r.id}/${r.status === "cancelled" ? "restore" : "cancel"}`, { body: {} }),
    onSuccess: async (ride) => {
      qc.setQueryData(["ride", ride.id], ride);
      await qc.invalidateQueries({ queryKey: ["rides"] });
    },
    onError: (e) => setError(e.message),
  });
  const clear = async () => {
    await dropDraft();
    loaded.current = false;
    navigate("/plan", true);
  };

  if (!form || !team || !spots || !weather || !rides) return <p className="muted small">Loading…</p>;
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
    ? [...route.pois].sort(
        (a, b) => Number(/coffee|food/.test(b.type)) - Number(/coffee|food/.test(a.type)) || a.route_d_m - b.route_d_m,
      )
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
              <span className="muted">No forecast for this date yet.</span>
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
              <label className="field">
                Date (any day)
                <input
                  type="date"
                  value={form.date}
                  min={today}
                  onChange={(e) => e.target.value && set({ date: e.target.value })}
                />
              </label>
              <label className="field">
                Roll-out
                <input
                  type="time"
                  value={form.time}
                  step={900}
                  onChange={(e) => set({ time: e.target.value || s.rollout })}
                />
              </label>
            </div>
            <div className="field" style={{ marginBottom: -4 }}>
              Start spot · weather {fmtTime(startMin)}–{fmtTime(startMin + durMin)}
            </div>
            <div
              className="spotlist"
              role="radiogroup"
              aria-label="Start spot"
              onKeyDown={(e) => {
                if (!["ArrowDown", "ArrowUp"].includes(e.key) || !active.length) return;
                e.preventDefault();
                const i = active.findIndex((x) => x.id === form.spotId);
                const next = active[
                  (i + (e.key === "ArrowDown" ? 1 : active.length - 1)) % active.length
                ] as SpotWithState;
                set({ spotId: next.id });
                (e.currentTarget.querySelector(`[data-spot="${next.id}"]`) as HTMLElement | null)?.focus();
              }}
            >
              {active.map(spotRow)}
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
              </>
            )}
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend
                className="field"
                style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}
              >
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
                          {u.distUnit === "km"
                            ? `km ${(p.route_d_m / 1000).toFixed(1)}`
                            : `mile ${(p.route_d_m / M_PER_MI).toFixed(1)}`}{" "}
                          · ≈ {fmtTime(etaAt(p.route_d_m / M_PER_MI, startMin, form.pace, s))}
                          {p.off_route_m > 50 ? ` · ${p.off_route_m} m off route` : ""}
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
