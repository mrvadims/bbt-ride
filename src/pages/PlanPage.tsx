// Plan an activity (Edit and Admin): What (sport, title, details) → When → Where → Route (ride and run) → Notes →
// Preview → Publish (DESIGN.md → Plan a ride, v2 Plan). The form autosaves as a per-editor draft on the server.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ActivityDetail, type ActivityUpdate, activityName, type RouteSummary } from "../../shared/api.ts";
import {
  etaAt,
  FT_PER_M,
  M_PER_MI,
  nearest,
  onlineService,
  type Poi,
  rideTimes,
  startDistance,
} from "../../shared/ride.ts";
import { ICON_KEYS, ICONS, type Icon, SPORT_ICON } from "../../shared/sport-icons.ts";
import {
  canBeIndoor,
  DETAILS_HINT,
  defaultLength,
  hasRoute,
  INDOOR_LABELS,
  minPerMile,
  mphFromMinPerMile,
  PACE_RANGE,
  rulesFor,
  SPORT_LABEL,
  SPORTS,
  type Sport,
  START_LABEL,
  timedByRoute,
} from "../../shared/sports.ts";
import {
  addDays,
  dayLabel,
  fmtTime,
  hhmmToMin,
  isDate,
  isWeekend,
  nextWeekendDays,
  nyNow,
  pad,
  weekendDates,
} from "../../shared/time.ts";
import { evaluate, warnings } from "../../shared/weather.ts";
import {
  ActivityBody,
  ActivityHeader,
  RwgpsTile,
  roadNote,
  WeatherAppRow,
  wxSummary,
} from "../components/ActivityBody.tsx";
import { RainBars } from "../components/charts.tsx";
import { DatePicker } from "../components/DatePicker.tsx";
import { DeleteActivity } from "../components/DeleteActivity.tsx";
import { History } from "../components/History.tsx";
import { HourTable } from "../components/HourTable.tsx";
import { SportIcon, SymbolIcon } from "../components/icons.tsx";
import { EmptyPanel, Panel, Section } from "../components/Panel.tsx";
import { PlanTabs } from "../components/PlanTabs.tsx";
import { SpotForm } from "../components/SpotForm.tsx";
import { nobodyInvited, Visibility } from "../components/Visibility.tsx";
import { WarningChips } from "../components/Warnings.tsx";
import { useActivityModel } from "../lib/activityModel.ts";
import { api } from "../lib/api.ts";
import {
  NO_WEATHER,
  refreshSpots,
  type SpotWithState,
  useActivities,
  useActivity,
  useMe,
  usePoll,
  useRoute,
  useRouteSearch,
  useSpots,
  useTeamSettings,
  useWeather,
} from "../lib/data.ts";
import { setPref, usePrefs } from "../lib/prefs.ts";
import { Link, navigate, useLocation } from "../lib/router.tsx";
import { units } from "../lib/units.ts";

interface Form {
  editing: string | null; // id of the published activity being edited
  base: string | null; // its updatedAt when editing began (the server refuses the update if it changed since)
  sport: Sport;
  icon: Icon; // Other only: the icon it shows
  title: string;
  date: string;
  time: string; // start (meet time for ride and run)
  endTime: string; // sports without a route
  outdoor: boolean;
  spotId: string | null;
  routeId: number | null;
  altOn: boolean;
  altId: number | null;
  labelA: string;
  labelB: string;
  stop: string | null | undefined; // undefined = pick the route's first coffee/food stop automatically
  pace: number; // mph (a run shows min/mi)
  details: string;
  notes: string;
  q: string;
  qAlt: string;
  guests: string[] | null; // private: the people invited; null: public (and drafts saved before private activities)
}

const isCoffee = (p: Poi) => /coffee|food/.test(p.type);
/** "HH:MM" plus minutes, kept within the same day (an activity ends by 23:45). */
const addMin = (hhmm: string, min: number) => {
  const t = Math.max(0, Math.min(23 * 60 + 45, hhmmToMin(hhmm) + min));
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};

// Only a full RideWithGPS link selects a route by ID: a bare number would be looked up on every keystroke.
const routeIdFrom = (q: string): number | null => {
  const m = q.match(/ridewithgps\.com\/routes\/(\d+)/);
  return m ? Number(m[1]) : null;
};

function fromActivity(a: ActivityDetail, date: string, editing: string | null): Partial<Form> {
  const [main, alt] = a.routes;
  return {
    editing,
    base: editing ? a.updatedAt : null,
    sport: a.sport,
    icon: a.icon ?? SPORT_ICON[a.sport],
    title: a.title,
    date,
    time: a.startTime,
    endTime: a.endTime ?? addMin(a.startTime, defaultLength(a.sport)),
    outdoor: a.outdoor,
    spotId: a.spotId,
    routeId: main?.routeId ?? null,
    q: main?.name ?? "",
    stop: main?.stop ?? null,
    altOn: Boolean(alt),
    altId: alt?.routeId ?? null,
    qAlt: alt?.name ?? "",
    labelA: alt ? (main?.label ?? "Full") : "Full",
    labelB: alt?.label ?? "Short",
    ...(a.pace ? { pace: a.pace } : {}),
    details: a.details,
    notes: a.notes,
    guests: a.private ? a.guests.map((g) => g.userId) : null,
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

function AddSpot({ onAdded, onCancel }: { onAdded: (id: string) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  return (
    <SpotForm
      title="New place"
      submitLabel="Add place"
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
  const prefs = usePrefs();
  const team = useTeamSettings().data;
  const me = useMe().data;
  const spots = useSpots().data;
  const wq = useWeather();
  const weather = wq.data ?? NO_WEATHER; // planning never waits on the forecast
  const acts = useActivities().data;
  const u = units(prefs.units);
  const [form, setForm] = useState<Form | null>(null);
  const [addingSpot, setAddingSpot] = useState(false);
  const [spotQ, setSpotQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [paceMsg, setPaceMsg] = useState<string | null>(null);
  const editId = query.get("edit");
  const reuseId = query.get("reuse");
  // "Plan this" on a date poll: its title, sport, the option's first day and, for a private poll, its people
  const pollId = editId || reuseId ? null : query.get("poll");
  const pollOptionId = query.get("option");
  const poll = usePoll(pollId).data;
  const source = useActivity(editId ?? reuseId);
  const sourceAct = source.data;
  const editingAct = useActivity(form?.editing).data; // stays current after Cancel / Restore
  const today = nyNow().date;
  const dateQuery = query.get("date");
  const dateParam = isDate(dateQuery) && dateQuery >= today ? dateQuery : null;
  const offered: Sport[] = team ? SPORTS.filter((x) => x === "other" || team.settings.sports.includes(x)) : [];

  // The first weekend day in the coming week without this sport posted; otherwise this Saturday.
  const nextFreeDay = (sport: Sport): string => {
    const [sat] = weekendDates(today);
    for (let d = sat; d <= addDays(today, 7); d = addDays(d, 1)) {
      if (isWeekend(d) && !(acts ?? []).some((a) => a.date === d && a.sport === sport && a.status === "published"))
        return d;
    }
    return sat;
  };
  const defaults = (sport: Sport): Pick<Form, "pace" | "time" | "endTime" | "outdoor"> => {
    const time = sport === "ride" ? (team?.settings.meetTime ?? "08:30") : "08:00";
    return {
      pace: sport === "run" ? 3600 / 540 : (team?.settings.pace ?? 17), // run: 9:00 min/mi
      time,
      endTime: addMin(time, defaultLength(sport)),
      outdoor: sport !== "swim", // a swim starts as a pool swim
    };
  };
  const freshForm = (sport: Sport): Form => ({
    editing: null,
    base: null,
    sport,
    icon: SPORT_ICON.other,
    title: "",
    date: dateParam ?? nextFreeDay(sport),
    spotId: null,
    routeId: null,
    altOn: false,
    altId: null,
    labelA: "Full",
    labelB: "Short",
    stop: undefined,
    details: "",
    notes: "",
    q: "",
    qAlt: "",
    guests: null,
    ...defaults(sport),
  });

  // Load the form once: editing an activity, reusing a past one, the saved draft, or a fresh plan.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !team || !spots || !acts) return;
    if ((editId || reuseId) && !sourceAct) return;
    if (pollId && !poll) return;
    loaded.current = true;
    const first = offered.includes(prefs.sport) ? prefs.sport : (offered[0] ?? "other");
    if (editId && sourceAct)
      return setForm({ ...freshForm(sourceAct.sport), ...fromActivity(sourceAct, sourceAct.date, sourceAct.id) });
    if (reuseId && sourceAct)
      return setForm({
        ...freshForm(sourceAct.sport),
        ...fromActivity(sourceAct, nextFreeDay(sourceAct.sport), null),
      });
    if (poll) {
      const option = poll.options.find((o) => o.id === pollOptionId) ?? poll.options[0];
      const sport = poll.sport && offered.includes(poll.sport) ? poll.sport : first;
      return setForm({
        ...freshForm(sport),
        title: poll.title.slice(0, 60),
        date: option && option.startsOn >= today ? option.startsOn : nextFreeDay(sport),
        guests: poll.private ? poll.guests.map((g) => g.userId).filter((id) => id !== me?.id) : null,
      });
    }
    api<{ form: Partial<Form> } | null>("/draft")
      .then((d) => {
        const restored = { ...freshForm(d?.form?.sport ?? first), ...(d?.form ?? {}) };
        if (restored.date < today)
          Object.assign(restored, { date: nextFreeDay(restored.sport), editing: null, base: null });
        if (dateParam) Object.assign(restored, { date: dateParam, editing: null, base: null });
        hadDraft.current = Boolean(d?.form);
        setForm(restored);
      })
      .catch(() => setForm(freshForm(first)));
  });

  // Autosave the draft (debounced), but only once the editor changes something: just opening an activity to edit or
  // reuse leaves the saved draft alone. The last save is kept so dropping the draft can wait for it.
  const dirty = useRef(false);
  const hadDraft = useRef(false); // a draft came back from the server, so Start over must delete it too
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!form || !dirty.current) return;
    const t = setTimeout(() => {
      saving.current = api("/draft", { method: "PUT", body: { form } }).catch(() => undefined);
    }, 800);
    return () => clearTimeout(t);
  }, [form]);
  /** Stops autosave, waits for a save in flight, then deletes the saved draft (this session's or a restored one). */
  const dropDraft = async () => {
    const saved = dirty.current || hadDraft.current;
    dirty.current = false;
    hadDraft.current = false;
    await saving.current;
    if (saved) await api("/draft", { method: "DELETE" }).catch(() => undefined);
  };

  const set = useCallback((patch: Partial<Form>) => {
    dirty.current = true;
    setForm((f) => (f ? { ...f, ...patch } : f));
  }, []);
  // Ride and run can have a route; at a real place it's required and sets the times (routed). At an online place every
  // sport has a start and an end, and a ride's or run's route is optional (DESIGN.md → Virtual meet-ups).
  const online = Boolean(form?.spotId && spots?.find((x) => x.id === form.spotId)?.online);
  const routeable = form ? hasRoute(form.sport) : false;
  const routed = form ? timedByRoute(form.sport, online) : false;
  const routeQ = useRoute(routeable ? form?.routeId : null);
  const altQ = useRoute(routeable && form?.altOn ? form.altId : null);
  const pastedMainQ = useRoute(form && routeable ? routeIdFrom(form.q) : null);
  const pastedAltQ = useRoute(form && routeable ? routeIdFrom(form.qAlt) : null);
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

  // Picking a route first selects the spot it starts from; a new ride route picks its first coffee/food stop.
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
    if (form.stop === undefined) patch.stop = form.sport === "ride" ? (route.pois.find(isCoffee)?.name ?? null) : null;
    if (Object.keys(patch).length) set(patch);
  }, [route, form, spots, set]);

  const draft =
    form?.spotId && (!routed || (form.routeId && route))
      ? {
          online,
          sport: form.sport,
          icon: form.sport === "other" && form.icon !== SPORT_ICON.other ? form.icon : null,
          title: form.title.trim(),
          date: form.date,
          startTime: form.time,
          endTime: routed ? null : form.endTime,
          spotId: form.spotId,
          outdoor: online ? false : canBeIndoor(form.sport) ? form.outdoor : true,
          pace: routed ? form.pace : 0,
          details: routed ? "" : form.details.trim(),
          notes: form.notes,
          status: "published" as const,
          routes:
            routeable && form.routeId && route
              ? [
                  {
                    label: form.altOn && form.altId ? form.labelA : "Main",
                    routeId: form.routeId,
                    stop: form.sport === "ride" && !online ? (form.stop ?? null) : null,
                    name: route.name,
                  },
                  ...(form.altOn && form.altId && altRoute
                    ? [
                        {
                          label: form.labelB,
                          routeId: form.altId,
                          stop:
                            form.sport === "ride" && !online && altRoute.pois.some((p) => p.name === form.stop)
                              ? (form.stop ?? null)
                              : null,
                          name: altRoute.name,
                        },
                      ]
                    : []),
                ]
              : [],
        }
      : null;
  const model = useActivityModel(draft);
  const inviteNeeded =
    form && me
      ? nobodyInvited(form.guests ?? null, me.id, form.editing ? (editingAct?.createdBy ?? null) : me.id)
      : false;

  const publish = useMutation({
    mutationFn: async (replaceId: string | null) => {
      if (!form || !draft) throw new Error(routed ? "Pick a start place and a route" : "Pick a place");
      if (form.altOn && form.altId && !altRoute) throw new Error("The alternate route hasn't loaded yet");
      if (inviteNeeded) throw new Error("Invite at least one person");
      const body: ActivityUpdate = {
        ...draft,
        routes: draft.routes.map(({ label, routeId, stop }) => ({ label, routeId, stop })),
        replaceId,
        guests: form.guests ?? undefined,
        makePublic: Boolean(editingAct?.private && !form.guests), // Make public, on Update
        ...(poll && !form.editing ? { pollId: poll.id, pollOptionId } : {}),
        baseUpdatedAt: form.base ?? "", // a POST ignores it
      };
      return form.editing
        ? api<ActivityDetail>(`/activities/${form.editing}`, { method: "PUT", body })
        : api<ActivityDetail>("/activities", { body });
    },
    onSuccess: async (act) => {
      await dropDraft(); // the server already deleted it; this catches a save that was in flight
      setPref("sport", act.sport);
      await qc.invalidateQueries({ queryKey: ["activities"] });
      if (poll) await qc.invalidateQueries({ queryKey: ["polls"] });
      qc.setQueryData(["activity", act.id], act);
      navigate(`/a/${act.id}`);
    },
    onError: (e) => setError(e.message),
  });
  const toggleCancel = useMutation({
    mutationFn: (a: ActivityDetail) =>
      api<ActivityDetail>(`/activities/${a.id}/${a.status === "cancelled" ? "restore" : "cancel"}`, { method: "POST" }),
    onSuccess: async (act, a) => {
      qc.setQueryData(["activity", act.id], act);
      // Our own Cancel/Restore isn't a conflict, but only if the form was up to date before it.
      setForm((f) => (f?.editing === act.id && f.base === a.updatedAt ? { ...f, base: act.updatedAt } : f));
      await qc.invalidateQueries({ queryKey: ["activities"] });
    },
    onError: (e) => setError(e.message),
  });
  const clear = async () => {
    await dropDraft();
    navigate("/plan", true);
    setForm(freshForm(form?.sport ?? "ride"));
  };
  const pickSport = (sport: Sport) => {
    if (!form || form.sport === sport) return;
    const taken = (acts ?? []).some((a) => a.date === form.date && a.sport === sport && a.status === "published");
    set({ sport, ...defaults(sport), ...(taken ? { date: nextFreeDay(sport) } : {}), stop: undefined });
  };

  if (source.isError && !source.data)
    return <p className="small">That activity couldn't be loaded. {source.error.message}</p>;
  if (!form || !team || !spots || !acts) return <p className="muted small">Loading…</p>;
  const s = team.settings;
  const active = spots.filter((x) => !x.archived);
  const quick = nextWeekendDays(today);
  const startMin = hhmmToMin(form.time);
  const times = routed && route ? rideTimes(route, form.time, form.pace, form.stop ?? null, s) : null;
  const durMin = routed ? (times ? times.end - times.start : s.durationH * 60) : hhmmToMin(form.endTime) - startMin;
  const outdoor = online ? false : canBeIndoor(form.sport) ? form.outdoor : true;
  const rules = rulesFor(form.sport, form.pace, s.warn);
  const spot = active.find((x) => x.id === form.spotId) ?? spots.find((x) => x.id === form.spotId);
  // Other activities that day: listed under the date. Several of a sport may share a day; publishing a new one with the
  // same sport offers Replace (cancel that one) as well as Publish another.
  const sameDay = acts.filter((a) => a.date === form.date && a.status === "published" && a.id !== form.editing);
  const sameSport = form.editing ? [] : sameDay.filter((a) => a.sport === form.sport);
  const clash = sameSport.length === 1 ? sameSport[0] : undefined;
  const sportName = SPORT_LABEL[form.sport].toLowerCase();
  const pois = route
    ? [...route.pois].sort((a, b) => Number(isCoffee(b)) - Number(isCoffee(a)) || a.route_d_m - b.route_d_m)
    : [];
  const far = route && spot ? startDistance(route, spot) : 0;
  const placeLabel = routed ? "Start spot" : "Place";
  // A long list of places gets a search box; the chosen place always stays in the list.
  const SEARCH_FROM = 7;
  const needle = spotQ.trim().toLowerCase();
  const shown =
    active.length >= SEARCH_FROM && needle
      ? active.filter((x) => x.id === form.spotId || `${x.name} ${x.note ?? ""}`.toLowerCase().includes(needle))
      : active;
  const indoorLabels = INDOOR_LABELS[form.sport];
  const runPace = form.sport === "run";
  const [paceLo, paceHi] = runPace ? PACE_RANGE.run : PACE_RANGE.ride;

  const spotRow = (sp: SpotWithState) => {
    const se = outdoor ? weather.series[sp.id] : undefined;
    const ev = se && durMin > 0 ? evaluate(se, form.date, startMin, durMin, rules, s) : null;
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
          {sp.online && <span className="small muted">Online · {onlineService(sp.maps_url)} · no weather check</span>}
          {outdoor && !sp.online && (
            <span className="small">
              {ev && se ? (
                <>
                  {wxSummary(ev.st, u)}
                  <WarningChips
                    list={warnings(ev, se, form.date, startMin, rules, weather.alerts[sp.id] ?? [])}
                    u={u}
                    lookback={s.lookback}
                  />
                </>
              ) : (
                <span className="muted">
                  {wq.isPending ? "Loading the forecast…" : "No forecast for this date yet."}
                </span>
              )}
            </span>
          )}
        </span>
      </button>
    );
  };

  const detail = (() => {
    if (!spot || !outdoor) return null;
    const se = weather.series[spot.id];
    const ev = se && durMin > 0 ? evaluate(se, form.date, startMin, durMin, rules, s) : null;
    const radar = `https://www.rainviewer.com/map.html?loc=${spot.lat},${spot.lng},9&oFa=0&oC=1&oU=0&oCS=1&oF=0&oAP=1&c=3&o=83&lm=1&layer=radar&sm=1&sn=1`;
    const feel = form.sport === "ride" ? "Bike" : runPace ? "Run" : undefined;
    return (
      <Panel id="spotdetail" label="Details" summary={`${spot.name} · weather${spot.note ? ", notes" : ""}`} collapsed>
        {ev && se && (
          <>
            <p className="small" style={{ margin: "0 0 8px" }}>
              {feel ? `${feel} feel ${u.temp(ev.st.feelMin)}–${u.temp(ev.st.feelMax)} · ` : ""}gusts{" "}
              {u.speed(ev.st.wgMax)} {u.speedUnit} · {u.rain(ev.st.rain)} rain
              {rules.road ? ` · ${roadNote(ev.st, u, s.lookback)}` : ""}
            </p>
            <div className="sub-h" style={{ marginTop: 4 }}>
              Rain −12 h → +8 h
            </div>
            <RainBars se={se} date={form.date} startMin={startMin} endMin={startMin + durMin} u={u} />
            <HourTable se={se} ev={ev} rules={rules} feel={feel} s={s} u={u} />
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
        {spot.note && (
          <div className="sub">
            <div className="sub-h">Notes</div>
            <p>{spot.note}</p>
          </div>
        )}
      </Panel>
    );
  })();

  const verb = form.editing ? "Update" : "Publish";

  return (
    <>
      <h1 className="sr">Plan an activity</h1>
      {!form.editing && <PlanTabs current="plan" />}
      {poll && !form.editing && (
        <p className="notice small">
          From the date poll <Link href={`/polls/${poll.id}`}>{poll.title}</Link>: publishing closes it and tells the
          people In or Maybe for that date.
        </p>
      )}
      {editingAct ? (
        <div className={`editbar${editingAct.status === "cancelled" ? " lv2" : ""}`}>
          <span>
            <b>
              Editing the {dayLabel(editingAct.date)} {SPORT_LABEL[editingAct.sport].toLowerCase()}
            </b>
            {editingAct.status === "cancelled" ? " · cancelled" : ""}
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
          <Section label="What">
            <div className="sportgrid" role="radiogroup" aria-label="Sport">
              {(form.editing ? [form.sport] : offered).map((x) => (
                <button key={x} type="button" role="radio" aria-checked={form.sport === x} onClick={() => pickSport(x)}>
                  <SportIcon sport={x} size={22} />
                  {SPORT_LABEL[x]}
                </button>
              ))}
            </div>
            {form.sport === "other" && (
              <div className="row2">
                <span className="tiny muted">Icon · {ICONS[form.icon]}</span>
                <div className="icongrid" role="radiogroup" aria-label="Icon">
                  {ICON_KEYS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={form.icon === k}
                      aria-label={ICONS[k]}
                      title={ICONS[k]}
                      onClick={() => set({ icon: k })}
                    >
                      <SymbolIcon icon={k} size={24} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {indoorLabels && !online && (
              <div className="seg" role="group" aria-label="Setting">
                <button type="button" aria-pressed={!form.outdoor} onClick={() => set({ outdoor: false })}>
                  {indoorLabels[0]}
                </button>
                <button type="button" aria-pressed={form.outdoor} onClick={() => set({ outdoor: true })}>
                  {indoorLabels[1]}
                </button>
              </div>
            )}
            <label className="field">
              Title (optional)
              <input
                value={form.title}
                maxLength={60}
                placeholder={routed ? "The route's name" : SPORT_LABEL[form.sport]}
                onChange={(e) => set({ title: e.target.value })}
              />
            </label>
            {!routed && (
              <label className="field">
                Details (optional)
                <input
                  value={form.details}
                  maxLength={80}
                  placeholder={DETAILS_HINT[form.sport]}
                  onChange={(e) => set({ details: e.target.value })}
                />
              </label>
            )}
          </Section>

          <Section label="When">
            <DatePicker label="Date" value={form.date} min={today} onChange={(date) => set({ date })} />
            {sameDay.length > 0 && (
              <p className="tiny" style={{ margin: "6px 0 0" }}>
                Also that day:{" "}
                {sameDay.map((a, i) => (
                  <span key={a.id}>
                    {i ? " · " : ""}
                    <Link href={`/a/${a.id}`}>
                      {activityName(a)} · {fmtTime(hhmmToMin(a.startTime))}
                    </Link>
                  </span>
                ))}
              </p>
            )}
            <div className="filters quickdates" role="group" aria-label="Quick pick: the next weekend days">
              {quick.map((d) => (
                <button key={d} type="button" aria-pressed={d === form.date} onClick={() => set({ date: d })}>
                  {dayLabel(d)}
                </button>
              ))}
            </div>
            <div className="row">
              <label className="field">
                {routeable && !routed ? "Start time" : START_LABEL[form.sport]}
                <input
                  type="time"
                  value={form.time}
                  step={900}
                  onChange={(e) => {
                    const time = e.target.value || form.time;
                    // Moving the start keeps the length the same (at least 15 minutes).
                    const len = Math.max(15, hhmmToMin(form.endTime) - hhmmToMin(form.time));
                    set({ time, endTime: addMin(time, len) });
                  }}
                />
              </label>
              {routed ? (
                <div className="field">
                  Back about
                  <span className="static-value">{times ? fmtTime(times.end) : "Pick a route"}</span>
                </div>
              ) : (
                <label className="field">
                  Ends
                  <input
                    type="time"
                    value={form.endTime}
                    step={900}
                    onChange={(e) => set({ endTime: e.target.value || form.endTime })}
                  />
                </label>
              )}
            </div>
            {!routed && durMin <= 0 && (
              <p className="tiny" role="alert" style={{ margin: 0, color: "var(--no-fg)" }}>
                The end time must be after the start.
              </p>
            )}
          </Section>

          <Section label="Where">
            <div className="field" style={{ marginBottom: -4 }}>
              {placeLabel}
              {outdoor && durMin > 0 ? ` · weather ${fmtTime(startMin)}–${fmtTime(startMin + durMin)}` : ""}
            </div>
            {active.length >= SEARCH_FROM && (
              <input
                type="search"
                className="spot-search"
                aria-label={`Search ${placeLabel.toLowerCase()}s`}
                placeholder={`Search ${active.length} places`}
                value={spotQ}
                onChange={(e) => setSpotQ(e.target.value)}
              />
            )}
            <div className="spotlist">
              <div
                className="spotgroup"
                role="radiogroup"
                aria-label={placeLabel}
                onKeyDown={(e) => {
                  if (!["ArrowDown", "ArrowUp"].includes(e.key) || !shown.length) return;
                  e.preventDefault();
                  const i = shown.findIndex((x) => x.id === form.spotId);
                  const step = e.key === "ArrowDown" ? 1 : -1;
                  const next = shown[
                    i < 0 ? (step > 0 ? 0 : shown.length - 1) : (i + step + shown.length) % shown.length
                  ] as SpotWithState;
                  set({ spotId: next.id });
                  (e.currentTarget.querySelector(`[data-spot="${next.id}"]`) as HTMLElement | null)?.focus();
                }}
              >
                {shown.map(spotRow)}
                {needle && shown.length === 0 && <p className="small muted">No place matches "{spotQ.trim()}".</p>}
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
                    <b>Add a place</b>
                    <span className="small muted">Paste a Google Maps pin</span>
                  </span>
                </button>
              )}
            </div>
            {detail}
          </Section>

          {routeable && (
            <Section label={online ? "Route (optional)" : "Route"}>
              {online && (
                <p className="tiny muted" style={{ margin: "0 0 8px" }}>
                  Online, a route is optional: add one if everyone rides the same course; it's linked from the activity.
                  Times come from Start and Ends.
                </p>
              )}
              <div className="route-row">
                <div className="fieldbox">
                  <label className="field">
                    RideWithGPS route
                    <input
                      type="search"
                      value={form.q}
                      placeholder="Search the library, or paste a RideWithGPS link"
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
                {route && <RwgpsTile url={route.url} />}
              </div>
              {routeError && (
                <p className="tiny" role="alert" style={{ margin: 0, color: "var(--no-fg)" }}>
                  {routeError}
                </p>
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
                  <div className="route-row">
                    <div className="fieldbox">
                      <label className="field">
                        Alternate route
                        <input
                          type="search"
                          value={form.qAlt}
                          placeholder="Search the library, or paste a RideWithGPS link"
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
                    {altRoute && <RwgpsTile url={altRoute.url} />}
                  </div>
                  {altError && (
                    <p className="tiny" role="alert" style={{ margin: 0, color: "var(--no-fg)" }}>
                      {altError}
                    </p>
                  )}
                </>
              )}
              {form.sport === "ride" && !online && (
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
              )}
              {routed && (
                <div className="row">
                  {runPace ? (
                    <label className="field">
                      Pace (min/mi)
                      {/* A text keyboard: the iPhone number pad has no ":". */}
                      <input
                        inputMode="text"
                        placeholder="9:00"
                        defaultValue={minPerMile(form.pace)}
                        key={form.pace}
                        onBlur={(e) => {
                          const mph = mphFromMinPerMile(e.target.value);
                          setPaceMsg(mph ? null : "Type the pace as minutes per mile, e.g. 9:30");
                          if (mph) set({ pace: Math.min(paceHi, Math.max(paceLo, mph)) });
                          else e.target.value = minPerMile(form.pace);
                        }}
                      />
                      {paceMsg && (
                        <span className="tiny" role="alert" style={{ color: "var(--no-fg)" }}>
                          {paceMsg}
                        </span>
                      )}
                    </label>
                  ) : (
                    <label className="field">
                      Pace (mph)
                      <input
                        type="number"
                        min={paceLo}
                        max={paceHi}
                        step={0.5}
                        defaultValue={form.pace}
                        key={form.pace}
                        onBlur={(e) =>
                          set({ pace: Math.min(paceHi, Math.max(paceLo, Number(e.target.value) || s.pace)) })
                        }
                      />
                    </label>
                  )}
                  <span />
                </div>
              )}
            </Section>
          )}

          <Section label="Notes">
            <textarea
              aria-label="Notes"
              placeholder={routed ? "Regroup points, café plan, lights…" : "What to bring, format, anything else…"}
              value={form.notes}
              maxLength={4000}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </Section>

          {(!form.editing || editingAct?.private) && me && (
            <Section label="Visibility">
              <Visibility
                guests={form.guests ?? null}
                onChange={(guests) => set({ guests })}
                meId={me.id}
                creatorId={form.editing ? (editingAct?.createdBy ?? null) : me.id}
                original={form.editing && editingAct ? editingAct.guests.map((g) => g.userId) : null}
              />
            </Section>
          )}
        </div>

        <div>
          <div className="kicker" style={{ margin: "4px 0 8px" }}>
            Preview · {dayLabel(form.date, true)}
          </div>
          {!draft || !model || model.loading || durMin <= 0 ? (
            <EmptyPanel
              label="Preview"
              text={
                !form.spotId
                  ? routed
                    ? "Pick a start place and a route to see the preview."
                    : "Pick a place to see the preview."
                  : routed
                    ? "Pick a route to see the preview."
                    : "Set an end time after the start."
              }
            />
          ) : (
            <>
              <ActivityHeader act={{ ...draft, private: Boolean(form.guests) }} m={model} />
              <ActivityBody act={draft} model={model} mode="preview" routeIndex={0} />
              {sameSport.length > 0 && (
                <div className="notice" style={{ margin: "12px 0 0" }}>
                  <b>
                    {sameSport.length === 1 ? `A ${sportName} is` : `${sameSport.length} ${sportName}s are`} already
                    posted for {dayLabel(form.date)}
                  </b>
                  {sameSport.map((a) => (
                    <div key={a.id} className="small">
                      {activityName(a)} · {fmtTime(hhmmToMin(a.startTime))} · {a.counts.in} going
                    </div>
                  ))}
                </div>
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
                  disabled={publish.isPending || inviteNeeded}
                  onClick={() => publish.mutate(null)}
                >
                  {sameSport.length
                    ? `Publish another ${sportName}`
                    : verb === "Publish"
                      ? "Publish"
                      : `${verb} ${sportName}`}
                </button>
                {clash && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={publish.isPending || inviteNeeded}
                    onClick={() => publish.mutate(clash.id)}
                  >
                    Replace {activityName(clash)}
                  </button>
                )}
              </div>
              {inviteNeeded && (
                <p className="tiny muted" style={{ margin: "8px 0 0" }}>
                  A private {sportName} needs at least one person invited (Visibility).
                </p>
              )}
              {clash && (
                <p className="tiny muted" style={{ margin: "8px 0 0" }}>
                  Replace cancels {activityName(clash)}; like any cancellation, everyone is told.
                </p>
              )}
            </>
          )}
          {/* Outside the preview, so an activity whose route or times won't load can still be cancelled or deleted */}
          {editingAct && (
            <>
              <div className="btnrow" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={toggleCancel.isPending}
                  onClick={() => toggleCancel.mutate(editingAct)}
                >
                  {editingAct.status === "cancelled" ? `Restore ${sportName}` : `Cancel ${sportName}`}
                </button>
              </div>
              {me && (me.role === "admin" || editingAct.createdBy === me.id) && (
                <DeleteActivity
                  act={editingAct}
                  sportName={sportName}
                  meId={me.id}
                  onDeleted={dropDraft}
                  onCancelInstead={() => toggleCancel.mutate(editingAct)}
                />
              )}
              <div style={{ marginTop: 16 }}>
                <History act={editingAct} id="plan-history" />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
