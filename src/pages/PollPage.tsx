// One date poll (DESIGN.md → Date polls): your answers (In / Maybe / Out per option, a note each, one note for the
// whole poll), the results ranked best first with who answered what, who hasn't answered yet (Nudge), Plan this, and the
// poll's Messages. Its creator and Admins can change the title, note and closing date, close it or delete it.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Me, PollAnswer, PollDetail, PollOptionDetail } from "../../shared/api.ts";
import { POLL_NOTE_MAX } from "../../shared/api.ts";
import { optionLabel, ranked } from "../../shared/polls.ts";
import { SPORT_LABEL } from "../../shared/sports.ts";
import { dayLabel, nyNow } from "../../shared/time.ts";
import { PersonButton } from "../components/Contact.tsx";
import { MessagesPanel } from "../components/Messages.tsx";
import { Section } from "../components/Panel.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { api } from "../lib/api.ts";
import { usePoll } from "../lib/data.ts";
import { Link, navigate } from "../lib/router.tsx";

const NOT_YET_SHOWN = 12; // the rest behind "+N more" (a poll for the whole team can ask dozens)
const LABEL: Record<PollAnswer, string> = { in: "In", maybe: "Maybe", out: "Out" };
const count = (o: PollOptionDetail, s: PollAnswer) => o.answers.filter((a) => a.status === s).length;

export function PollPage({ id, me }: { id: string; me: Me }) {
  const q = usePoll(id);
  const qc = useQueryClient();
  // Opening it records the visit; the reply says when the viewer last read its thread (the "new" divider).
  const [since, setSince] = useState<string | null | undefined>(undefined);
  const recorded = useRef("");
  useEffect(() => {
    if (recorded.current === id) return;
    recorded.current = id;
    api<{ seenBefore: string | null }>(`/polls/${id}/seen`, { method: "POST" })
      .then((r) => {
        setSince(r.seenBefore);
        qc.invalidateQueries({ queryKey: ["polls"] });
      })
      .catch(() => undefined);
  }, [id, qc]);
  if (q.isPending) return <p className="muted small">Loading…</p>;
  if (!q.data)
    return (
      <section className="panel empty">
        <p>
          <b>Date poll not found.</b>
        </p>
        <p className="muted small">It may have been deleted, or it's for other people.</p>
        <Link href="/">Back to Home</Link>
      </section>
    );
  return <View poll={q.data} me={me} since={since} />;
}

function View({ poll, me, since }: { poll: PollDetail; me: Me; since?: string | null }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nudged, setNudged] = useState<number | null>(null);
  const [allNotYet, setAllNotYet] = useState(false);
  const done = (p: PollDetail) => {
    qc.setQueryData(["poll", p.id], p);
    qc.invalidateQueries({ queryKey: ["polls"] });
    setError(null);
  };
  const call = useMutation({
    mutationFn: (req: { path: string; method?: string; body?: unknown }) => api<PollDetail>(req.path, req),
    onSuccess: done,
    onError: (e) => setError(e.message),
  });
  const manages = poll.createdBy === me.id || me.role === "admin";
  const plans = me.role !== "view";
  const mine = (o: PollOptionDetail) => o.answers.find((a) => a.userId === me.id);
  const answer = (o: PollOptionDetail, status: PollAnswer) => {
    const cur = mine(o);
    call.mutate({
      path: `/polls/${poll.id}/answers`,
      method: "PUT",
      body: { answers: [{ optionId: o.id, status: cur?.status === status ? null : status, note: cur?.note ?? null }] },
    });
  };
  const best = ranked(poll.options.map((o) => ({ ...o, inCount: count(o, "in"), maybeCount: count(o, "maybe") })));
  const top = best[0] && best[0].inCount + best[0].maybeCount > 0 ? best[0] : null;
  const myNote = poll.notes.find((n) => n.userId === me.id)?.note ?? "";
  const asked = poll.private ? `${poll.guests.length} people picked` : "the whole team";

  return (
    <section className="poll">
      <div className="poll-h">
        <span className="kicker">
          Date poll{poll.sport ? ` · ${SPORT_LABEL[poll.sport]}` : ""}
          {poll.createdByName ? ` · from ${poll.createdByName}` : ""}
        </span>
        <h1>{poll.title}</h1>
        {poll.note && <p className="small">{poll.note}</p>}
        <span className="small muted">
          {poll.activityId ? (
            <>
              Planned: <Link href={`/a/${poll.activityId}`}>{poll.activityTitle ?? "see the activity"}</Link>
            </>
          ) : poll.open ? (
            `Answers close ${dayLabel(poll.closesOn)} · asking ${asked}`
          ) : (
            `Answers closed · asked ${asked}`
          )}
        </span>
      </div>

      {poll.open && (
        <Section label="Your answers">
          <div className="poll-answer">
            {poll.options.map((o) => {
              const cur = mine(o);
              return (
                <div key={o.id} className="poll-row">
                  <b>{optionLabel(o)}</b>
                  <div className="seg poll-seg" role="group" aria-label={`Your answer for ${optionLabel(o)}`}>
                    {(["in", "maybe", "out"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`a-${s}`}
                        aria-pressed={cur?.status === s}
                        disabled={call.isPending}
                        onClick={() => answer(o, s)}
                      >
                        {LABEL[s]}
                      </button>
                    ))}
                  </div>
                  {cur && (
                    <OptionNote
                      key={cur.note ?? ""}
                      value={cur.note ?? ""}
                      onSave={(note) =>
                        call.mutate({
                          path: `/polls/${poll.id}/answers`,
                          method: "PUT",
                          body: { answers: [{ optionId: o.id, status: cur.status, note: note || null }] },
                        })
                      }
                    />
                  )}
                </div>
              );
            })}
            <button
              type="button"
              className="btn btn-outline"
              disabled={call.isPending}
              onClick={() =>
                call.mutate({
                  path: `/polls/${poll.id}/answers`,
                  method: "PUT",
                  body: {
                    answers: poll.options.map((o) => ({ optionId: o.id, status: "out", note: mine(o)?.note ?? null })),
                  },
                })
              }
            >
              Can't make any of these
            </button>
            <PollNote
              key={myNote}
              value={myNote}
              onSave={(note) => call.mutate({ path: `/polls/${poll.id}/answers`, method: "PUT", body: { note } })}
            />
            <p className="tiny muted" style={{ margin: 0 }}>
              Saved as you tap. Everyone asked sees the answers.
            </p>
          </div>
        </Section>
      )}
      {error && (
        <p className="small" role="alert" style={{ color: "var(--no-fg)", margin: 0 }}>
          {error}
        </p>
      )}

      <Section label="Results">
        <div className="poll-results">
          {best.map((o) => {
            const n = Math.max(poll.askedCount, 1);
            const isTop = o === top;
            return (
              <div key={o.id} className={`poll-res${isTop ? " best" : ""}`}>
                {isTop && <span className="kicker">★ Best so far</span>}
                <b>{optionLabel(o)}</b>
                <div className="poll-bar" aria-hidden="true">
                  <span className="b-in" style={{ width: `${(100 * o.inCount) / n}%` }} />
                  <span className="b-maybe" style={{ width: `${(100 * o.maybeCount) / n}%` }} />
                  <span className="b-out" style={{ width: `${(100 * count(o, "out")) / n}%` }} />
                </div>
                <span className="small">
                  <b>{o.inCount} in</b> · {o.maybeCount} maybe · {count(o, "out")} out
                </span>
                {(["in", "maybe", "out"] as const).map((s) => {
                  const people = o.answers.filter((a) => a.status === s);
                  return people.length ? (
                    <p key={s} className="small poll-who">
                      <b>{LABEL[s]}:</b>{" "}
                      {people.map((a, i) => (
                        <span key={a.userId}>
                          {i ? ", " : ""}
                          <PersonButton userId={a.userId} className="linkbtn">
                            {a.userId === me.id ? "You" : a.name}
                          </PersonButton>
                          {a.note ? ` (“${a.note}”)` : ""}
                        </span>
                      ))}
                    </p>
                  ) : null;
                })}
                {plans && !poll.activityId && (
                  <button
                    type="button"
                    className={`btn ${isTop ? "btn-primary" : "btn-outline"} btn-sm`}
                    style={{ alignSelf: "flex-start" }}
                    onClick={() => navigate(`/plan?poll=${poll.id}&option=${o.id}`)}
                  >
                    Plan this
                  </button>
                )}
              </div>
            );
          })}
          {poll.notes.length > 0 && (
            <div className="poll-notes">
              {poll.notes.map((n) => (
                <p key={n.userId} className="small">
                  <b>{n.userId === me.id ? "You" : n.name}:</b> {n.note}
                </p>
              ))}
            </div>
          )}
          <div className="poll-notyet">
            <span className="small">
              <b>
                {poll.answeredCount} of {poll.askedCount}
              </b>{" "}
              answered{poll.notYet.length ? `. Not yet (${poll.notYet.length}):` : "."}
            </span>
            {poll.notYet.length > 0 && (
              <div className="plist">
                {(allNotYet ? poll.notYet : poll.notYet.slice(0, NOT_YET_SHOWN)).map((p) => (
                  <PersonButton key={p.userId} userId={p.userId} className="person quiet">
                    {p.userId === me.id ? "You" : p.name}
                  </PersonButton>
                ))}
                {!allNotYet && poll.notYet.length > NOT_YET_SHOWN && (
                  <button type="button" className="linkbtn small" onClick={() => setAllNotYet(true)}>
                    +{poll.notYet.length - NOT_YET_SHOWN} more
                  </button>
                )}
              </div>
            )}
            {manages && poll.open && poll.notYet.some((p) => p.userId !== me.id) && (
              <div className="btnrow">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() =>
                    api<{ nudged: number }>(`/polls/${poll.id}/nudge`, { method: "POST" })
                      .then((r) => setNudged(r.nudged))
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  Nudge them
                </button>
                <span className="tiny muted">
                  {nudged === null ? "One notification to the people who haven't answered" : `Sent to ${nudged}`}
                </span>
              </div>
            )}
          </div>
        </div>
      </Section>

      <div className="panels">
        <MessagesPanel
          id="poll-messages"
          messages={poll.messages}
          me={me}
          canPost
          past={false}
          postPath={`/polls/${poll.id}/messages`}
          onData={(data) => done(data as PollDetail)}
          only={poll.private ? poll.guests.map((g) => g.userId) : undefined}
          group={poll.private}
          since={since}
        />
      </div>

      {manages && (
        <div className="btnrow poll-manage">
          <button type="button" className="linkbtn" onClick={() => setEditing(true)}>
            Edit poll
          </button>
          {poll.open && (
            <button
              type="button"
              className="linkbtn"
              onClick={() =>
                window.confirm("Close answers now?") && call.mutate({ path: `/polls/${poll.id}/close`, method: "POST" })
              }
            >
              Close answers
            </button>
          )}
          <button
            type="button"
            className="linkbtn"
            onClick={() =>
              window.confirm("Delete this date poll, with its answers and messages?") &&
              api(`/polls/${poll.id}`, { method: "DELETE" })
                .then(() => qc.invalidateQueries({ queryKey: ["polls"] }))
                .then(() => navigate("/"))
                .catch((e: Error) => setError(e.message))
            }
          >
            Delete
          </button>
        </div>
      )}
      {editing && <EditPoll poll={poll} onClose={() => setEditing(false)} onSaved={done} />}
    </section>
  );
}

/** A short note on one answer ("after 9am"), saved when it loses focus. */
function OptionNote({ value, onSave }: { value: string; onSave: (note: string) => void }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(Boolean(value));
  if (!open)
    return (
      <button type="button" className="linkbtn small" onClick={() => setOpen(true)}>
        + Add a note
      </button>
    );
  return (
    <input
      aria-label="Note"
      placeholder="e.g. after 9am"
      maxLength={POLL_NOTE_MAX}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== value && onSave(text.trim())}
    />
  );
}

/** The note on the whole poll ("Away until Nov 5"), saved when it loses focus. */
function PollNote({ value, onSave }: { value: string; onSave: (note: string | null) => void }) {
  const [text, setText] = useState(value);
  return (
    <label className="field">
      Anything else? (optional)
      <input
        placeholder="e.g. Away until Nov 5, try later dates"
        maxLength={POLL_NOTE_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== value && onSave(text.trim() || null)}
      />
    </label>
  );
}

function EditPoll({
  poll,
  onClose,
  onSaved,
}: {
  poll: PollDetail;
  onClose: () => void;
  onSaved: (p: PollDetail) => void;
}) {
  const [title, setTitle] = useState(poll.title);
  const [note, setNote] = useState(poll.note);
  const [closesOn, setClosesOn] = useState(poll.closesOn);
  const [error, setError] = useState<string | null>(null);
  const last = poll.options.reduce((m, o) => (o.endsOn > m ? o.endsOn : m), "");
  const save = useMutation({
    mutationFn: () => api<PollDetail>(`/polls/${poll.id}`, { method: "PUT", body: { title, note, closesOn } }),
    onSuccess: (p) => {
      onSaved(p);
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Sheet label="Edit date poll" onClose={onClose}>
      <div className="confirm">
        <h2>Edit date poll</h2>
        <label className="field">
          Title
          <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          Note
          <textarea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="field">
          Answers close
          <input
            type="date"
            value={closesOn}
            min={nyNow().date}
            max={last}
            disabled={!poll.open}
            onChange={(e) => setClosesOn(e.target.value)}
          />
        </label>
        {error && (
          <p className="small" role="alert" style={{ color: "var(--no-fg)" }}>
            {error}
          </p>
        )}
        <div className="confirm-btns">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!title.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </button>
          <button type="button" className="linkbtn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Sheet>
  );
}
