// Date polls on Home and the poll list (DESIGN.md → Date polls): an open poll you haven't answered sits at the top of
// Home as a card; once answered it moves below the list, as a row, until answers close.
import type { PollSummary } from "../../shared/api.ts";
import { optionLabel } from "../../shared/polls.ts";
import { SPORT_LABEL } from "../../shared/sports.ts";
import { dayLabel } from "../../shared/time.ts";
import { usePolls } from "../lib/data.ts";
import { Link } from "../lib/router.tsx";

const CalendarCheck = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4" />
  </svg>
);

const dates = (p: PollSummary) =>
  p.options.length <= 3
    ? p.options.map(optionLabel).join(", ")
    : `${p.options.length} options from ${dayLabel(p.options[0]?.startsOn ?? "")}`;
const news = (p: PollSummary) =>
  p.newMessages ? ` · ${p.newMessages} new message${p.newMessages === 1 ? "" : "s"}` : "";

/** Top of Home: open polls waiting for your answer. */
export function PollsToAnswer() {
  const polls = (usePolls().data ?? []).filter((p) => p.open && !p.answered);
  if (!polls.length) return null;
  return (
    <div className="poll-cards">
      {polls.map((p) => (
        <section key={p.id} className="panel poll-card" aria-label={`Date poll: ${p.title}`}>
          <span className="kicker poll-k">
            <CalendarCheck />
            Date poll{p.sport ? ` · ${SPORT_LABEL[p.sport]}` : ""}
            {p.createdByName ? ` · from ${p.createdByName}` : ""}
          </span>
          <b>{p.title}</b>
          <span className="small">{dates(p)}</span>
          <span className="tiny muted">
            {p.answeredCount} of {p.askedCount} answered · answers close {dayLabel(p.closesOn)}
            {news(p)}
          </span>
          <div className="btnrow">
            <Link className="btn btn-primary btn-sm" href={`/polls/${p.id}`}>
              Answer
            </Link>
          </div>
        </section>
      ))}
    </div>
  );
}

const Row = ({ p }: { p: PollSummary }) => (
  <Link className="poll-line" href={`/polls/${p.id}`}>
    <span className="poll-line-b">
      <b>{p.title}</b>
      <span className="tiny muted">
        {p.activityId ? "Planned" : p.open ? `Open until ${dayLabel(p.closesOn)}` : "Closed"} · {p.answeredCount} of{" "}
        {p.askedCount} answered{news(p)}
      </span>
    </span>
    <span aria-hidden="true">›</span>
  </Link>
);

/** Below Home's list: open polls you've answered, and a link to all of them. */
export function OpenPolls() {
  const all = usePolls().data ?? [];
  const polls = all.filter((p) => p.open && p.answered);
  if (!all.length) return null;
  return (
    <div className="poll-open">
      {polls.length > 0 && <div className="sub-h">Open date polls</div>}
      {polls.map((p) => (
        <Row key={p.id} p={p} />
      ))}
      <p className="center" style={{ margin: "6px 0 0" }}>
        <Link className="small" href="/polls">
          All date polls
        </Link>
      </p>
    </div>
  );
}

/** /polls: open ones first, then recent closed ones. */
export function PollList({ canCreate }: { canCreate: boolean }) {
  const q = usePolls();
  const all = q.data ?? [];
  const open = all.filter((p) => p.open);
  const closed = all.filter((p) => !p.open);
  return (
    <section className="help">
      <div>
        <div className="kicker">Date polls</div>
        <h1>Which date works?</h1>
        {canCreate && (
          <Link className="btn btn-outline btn-sm" href="/polls/new">
            New date poll
          </Link>
        )}
      </div>
      {q.isPending ? (
        <p className="muted small">Loading…</p>
      ) : all.length ? (
        <>
          {open.length > 0 && <div className="sub-h">Open</div>}
          {open.map((p) => (
            <Row key={p.id} p={p} />
          ))}
          {closed.length > 0 && <div className="sub-h">Closed</div>}
          {closed.map((p) => (
            <Row key={p.id} p={p} />
          ))}
        </>
      ) : (
        <p className="muted small">No date polls yet.</p>
      )}
    </section>
  );
}
