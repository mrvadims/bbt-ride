// New date poll (DESIGN.md → Date polls): Plan's second tab. A title, an optional sport and note, the dates to ask
// about (single days or blocks of 2–4 days, picked on a month calendar, up to 14, within a year), who's asked, and when
// answers close (by default the day before the first date).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { PollDetail } from "../../shared/api.ts";
import {
  byDate,
  daysIn,
  defaultCloses,
  lastDay,
  nextWeekend,
  optionLabel,
  overlaps,
  POLL_AHEAD_DAYS,
  POLL_BLOCK_DAYS_MAX,
  POLL_OPTIONS_MAX,
  type PollDates,
} from "../../shared/polls.ts";
import { SPORT_LABEL, SPORTS, type Sport } from "../../shared/sports.ts";
import { addDays, dayLabel, nyNow } from "../../shared/time.ts";
import { SportIcon } from "../components/icons.tsx";
import { Section } from "../components/Panel.tsx";
import { PlanTabs } from "../components/PlanTabs.tsx";
import { Visibility } from "../components/Visibility.tsx";
import { api } from "../lib/api.ts";
import { useMe, useTeamSettings } from "../lib/data.ts";
import { navigate } from "../lib/router.tsx";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const pad = (n: number) => String(n).padStart(2, "0");
const covers = (o: PollDates, d: string) => o.startsOn <= d && d <= o.endsOn;

/** A month of days to pick from: tap a day (single days), or a first and a last day (blocks). */
function MonthPicker({
  today,
  options,
  onChange,
}: {
  today: string;
  options: PollDates[];
  onChange: (options: PollDates[], problem?: string) => void;
}) {
  const [blocks, setBlocks] = useState(false);
  const [month, setMonth] = useState(today.slice(0, 7)); // YYYY-MM
  const [start, setStart] = useState<string | null>(null); // a block's first day, waiting for its last
  const last = addDays(today, POLL_AHEAD_DAYS);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = `${month}-01`;
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay();
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };
  const full = options.length >= POLL_OPTIONS_MAX;

  const tap = (d: string) => {
    const hit = options.find((o) => covers(o, d));
    if (hit) return onChange(options.filter((o) => o !== hit)); // tapping a picked date removes it
    if (!blocks) {
      if (full) return onChange(options, `Pick at most ${POLL_OPTIONS_MAX} options`);
      setStart(null);
      return onChange(byDate([...options, { startsOn: d, endsOn: d }]));
    }
    if (!start || d < start) return setStart(d);
    if (d === start) return setStart(null);
    if (daysIn({ startsOn: start, endsOn: d }) > POLL_BLOCK_DAYS_MAX) {
      setStart(d);
      return onChange(options, `A block is at most ${POLL_BLOCK_DAYS_MAX} days`);
    }
    if (options.some((o) => overlaps(o, { startsOn: start, endsOn: d }))) {
      setStart(null);
      return onChange(options, "That block overlaps a date already picked");
    }
    if (full) return onChange(options, `Pick at most ${POLL_OPTIONS_MAX} options`);
    setStart(null);
    onChange(byDate([...options, { startsOn: start, endsOn: d }]));
  };

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(<span key={`b${i}`} />);
  for (let n = 1; n <= length; n++) {
    const d = `${month}-${pad(n)}`;
    const hit = options.find((o) => covers(o, d));
    const cls = [
      "pcal-d",
      d === today ? "today" : "",
      hit ? "picked" : "",
      hit && hit.startsOn !== hit.endsOn ? (d === hit.startsOn ? "from" : d === hit.endsOn ? "to" : "mid") : "",
      d === start ? "start" : "",
    ]
      .filter(Boolean)
      .join(" ");
    cells.push(
      <button
        key={d}
        type="button"
        className={cls}
        disabled={d < today || d > last}
        aria-pressed={Boolean(hit) || d === start}
        aria-label={dayLabel(d, true)}
        onClick={() => tap(d)}
      >
        {n}
      </button>,
    );
  }
  return (
    <div className="pcal">
      <div className="seg" role="group" aria-label="Pick">
        <button
          type="button"
          aria-pressed={!blocks}
          onClick={() => {
            setBlocks(false);
            setStart(null);
          }}
        >
          Single days
        </button>
        <button type="button" aria-pressed={blocks} onClick={() => setBlocks(true)}>
          Blocks (2–{POLL_BLOCK_DAYS_MAX} days)
        </button>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        {blocks
          ? start
            ? `From ${dayLabel(start)}: now tap the last day.`
            : "Tap the first day, then the last day."
          : "Tap a day to add it; tap it again to remove it."}
      </p>
      <div className="pcal-h">
        <button
          type="button"
          className="iconbtn"
          aria-label="Previous month"
          disabled={first <= today}
          onClick={() => shift(-1)}
        >
          ‹
        </button>
        <b>
          {MONTHS[m - 1]} {y}
        </b>
        <button
          type="button"
          className="iconbtn"
          aria-label="Next month"
          disabled={`${month}-31` >= last}
          onClick={() => shift(1)}
        >
          ›
        </button>
      </div>
      <div className="pcal-g">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
          <span key={`${w}${i}`} className="pcal-w" aria-hidden="true">
            {w}
          </span>
        ))}
        {cells}
      </div>
    </div>
  );
}

export function PollNew() {
  const qc = useQueryClient();
  const me = useMe().data;
  const team = useTeamSettings().data;
  const today = nyNow().date;
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState<Sport | null>(null);
  const [note, setNote] = useState("");
  const [options, setOptions] = useState<PollDates[]>([]);
  const [guests, setGuests] = useState<string[] | null>(null);
  const [closesOn, setClosesOn] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offered = team ? SPORTS.filter((x) => x === "other" || team.settings.sports.includes(x)) : [];
  const pick = (next: PollDates[], problem?: string) => {
    setOptions(next);
    setHint(problem ?? null);
  };
  const weekend = nextWeekend(today, options);
  const send = useMutation({
    mutationFn: () => {
      if (!title.trim()) throw new Error("Give it a title");
      if (!options.length) throw new Error("Pick at least one date");
      if (guests && !guests.some((id) => id !== me?.id)) throw new Error("Pick who to ask");
      return api<PollDetail>("/polls", {
        body: { title, note, sport, options, guests, closesOn: closesOn || null },
      });
    },
    onSuccess: async (p) => {
      qc.setQueryData(["poll", p.id], p);
      await qc.invalidateQueries({ queryKey: ["polls"] });
      navigate(`/polls/${p.id}`);
    },
    onError: (e) => setError(e.message),
  });

  return (
    <>
      <h1 className="sr">New date poll</h1>
      <PlanTabs current="poll" />
      <div className="panels poll-new">
        <Section label="What">
          <label className="field">
            Title
            <input
              value={title}
              maxLength={80}
              placeholder="e.g. Gunks weekend?"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="field">
            Sport (optional)
            <div className="sportgrid" role="radiogroup" aria-label="Sport">
              {offered.map((x) => (
                <button
                  key={x}
                  type="button"
                  role="radio"
                  aria-checked={sport === x}
                  onClick={() => setSport(sport === x ? null : x)}
                >
                  <SportIcon sport={x} size={22} />
                  {SPORT_LABEL[x]}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            Note (optional)
            <textarea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} />
          </label>
        </Section>

        <Section label="Dates">
          <p className="tiny muted" style={{ margin: 0 }}>
            Any dates in the next 12 months · {options.length} of {POLL_OPTIONS_MAX} options
          </p>
          <MonthPicker today={today} options={options} onChange={pick} />
          {hint && (
            <p className="small" role="alert" style={{ color: "var(--no-fg)", margin: 0 }}>
              {hint}
            </p>
          )}
          {options.length > 0 && (
            <ul className="poll-opts">
              {options.map((o) => (
                <li key={`${o.startsOn}/${o.endsOn}`}>
                  <span>{optionLabel(o)}</span>
                  <button
                    type="button"
                    className="linkbtn"
                    aria-label={`Remove ${optionLabel(o)}`}
                    onClick={() => pick(options.filter((x) => x !== o))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {weekend && options.length < POLL_OPTIONS_MAX && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ alignSelf: "flex-start" }}
              onClick={() => pick(byDate([...options, weekend]))}
            >
              + Next weekend ({optionLabel(weekend)})
            </button>
          )}
        </Section>

        <Section label="Who's asked">
          {me && (
            <Visibility poll guests={guests} onChange={setGuests} meId={me.id} creatorId={me.id} original={null} />
          )}
          <label className="field">
            Answers close
            <input
              type="date"
              value={closesOn || (options.length ? defaultCloses(options, today) : "")}
              min={today}
              max={options.length ? lastDay(options) : undefined}
              disabled={!options.length}
              onChange={(e) => setClosesOn(e.target.value)}
            />
          </label>
          <p className="tiny muted" style={{ margin: 0 }}>
            Defaults to the day before the first date. People can change their answers until then.
          </p>
        </Section>

        {error && (
          <p className="small" role="alert" style={{ color: "var(--no-fg)", margin: 0 }}>
            {error}
          </p>
        )}
        <button type="button" className="btn btn-primary" disabled={send.isPending} onClick={() => send.mutate()}>
          {guests ? "Send to the people picked" : "Send to the team"}
        </button>
      </div>
    </>
  );
}
