// Announcements (DESIGN.md → v2, Announcements): the banner everyone sees until they tap Got it, the page that lists
// recent ones (account menu), and the Admins' panel in Settings to post, edit and end them.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Announcement, AnnouncementAdmin } from "../../shared/api.ts";
import { dayLabel, nyNow } from "../../shared/time.ts";
import { api } from "../lib/api.ts";
import { useAnnouncements, useMe } from "../lib/data.ts";
import { Link } from "../lib/router.tsx";
import { PersonButton } from "./Contact.tsx";
import { Linkified } from "./Linkified.tsx";
import { Panel } from "./Panel.tsx";
import { Sheet } from "./Sheet.tsx";

const day = (iso: string) => dayLabel(iso.slice(0, 10));
const MegaphoneIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" />
    <path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" />
  </svg>
);

/** Under the top bar on every page: the newest active announcement the person hasn't tapped Got it on. */
export function AnnouncementBanner() {
  const qc = useQueryClient();
  const list = useAnnouncements().data ?? [];
  const unseen = list.filter((a) => a.active && !a.seen);
  const seen = useMutation({
    mutationFn: (id: string) => api(`/announcements/${id}/seen`, { method: "POST" }),
    onMutate: (id) =>
      qc.setQueryData<Announcement[]>(["announcements"], (l) =>
        l?.map((a) => (a.id === id ? { ...a, seen: true } : a)),
      ),
  });
  const a = unseen[0];
  if (!a) return null;
  return (
    <section className="announce" aria-label="Announcement">
      <div className="announce-h">
        <MegaphoneIcon />
        <span className="kicker">Announcement · {day(a.createdAt)}</span>
        {unseen.length > 1 && <span className="tiny muted">1 of {unseen.length}</span>}
      </div>
      <b>{a.title}</b>
      <p className="small">
        <Linkified text={a.body} />
      </p>
      <div className="btnrow">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => seen.mutate(a.id)}>
          Got it
        </button>
      </div>
    </section>
  );
}

/** /announcements (account menu): the active ones and the last 90 days', newest first. */
export function AnnouncementsPage() {
  const q = useAnnouncements();
  const list = q.data;
  return (
    <section className="help">
      <div>
        <div className="kicker">From the team admins</div>
        <h1>Announcements</h1>
        <p className="muted small">The last 90 days, newest first.</p>
        {useMe().data?.role === "admin" && (
          <p className="small">
            Admins: post, edit and see who got each one in <Link href="/settings">Settings → Announcements</Link>.
          </p>
        )}
      </div>
      {!list ? (
        <p className="muted small">Loading…</p>
      ) : list.length ? (
        list.map((a) => (
          <article key={a.id} className="panel announce-item">
            <span className="tiny muted">
              {day(a.createdAt)}
              {a.by ? ` · ${a.by}` : ""}
              {a.active && a.endsOn ? ` · until ${dayLabel(a.endsOn)}` : ""}
            </span>
            <b>{a.title}</b>
            <p className="small">
              <Linkified text={a.body} />
            </p>
          </article>
        ))
      ) : (
        <p className="muted small">No announcements.</p>
      )}
    </section>
  );
}

interface Draft {
  title: string;
  body: string;
  endsOn: string;
}
const EMPTY: Draft = { title: "", body: "", endsOn: "" };

/** Settings → Announcements (Admins). */
export function AnnouncementsAdmin() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["announcements-all"],
    queryFn: () => api<AnnouncementAdmin[]>("/announcements/all"),
  });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [notify, setNotify] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [who, setWho] = useState<AnnouncementAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["announcements-all"] }),
      qc.invalidateQueries({ queryKey: ["announcements"] }),
    ]);
  const call = useMutation({
    mutationFn: (req: { path: string; method?: string; body?: unknown }) => api(req.path, req),
    onSuccess: () => {
      setError(null);
      setDraft(EMPTY);
      setEditing(null);
      setNotify(true);
      refresh();
    },
    onError: (e) => setError(e.message),
  });
  const list = q.data ?? [];
  const active = list.filter((a) => a.active);
  const past = list.filter((a) => !a.active);
  const save = () => {
    const body = { title: draft.title, body: draft.body, endsOn: draft.endsOn || null };
    call.mutate(
      editing
        ? { path: `/announcements/${editing}`, method: "PUT", body }
        : { path: "/announcements", body: { ...body, notify } },
    );
  };
  const row = (a: AnnouncementAdmin) => (
    <div key={a.id} className="announce-row">
      <div className="announce-row-b">
        <b>{a.title}</b>
        <span className="tiny muted">
          {day(a.createdAt)}
          {a.endedAt
            ? ` – ${day(a.endedAt)}`
            : a.endsOn
              ? ` · ${a.active ? "until" : "ended"} ${dayLabel(a.endsOn)}`
              : " · no end date"}
        </span>
      </div>
      <button type="button" className="linkbtn small" onClick={() => setWho(a)}>
        {a.seenCount} of {a.teamCount} got it
      </button>
      {a.active && (
        <div className="btnrow">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              setEditing(a.id);
              setDraft({ title: a.title, body: a.body, endsOn: a.endsOn ?? "" });
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={call.isPending}
            onClick={() => call.mutate({ path: `/announcements/${a.id}/end`, method: "POST" })}
          >
            End now
          </button>
        </div>
      )}
    </div>
  );
  return (
    <Panel
      id="set-announce"
      label="Announcements"
      titled
      collapsed
      summary={active.length ? `${active.length} active` : "None active"}
    >
      <div className="announce-form">
        <div className="kicker">{editing ? "Edit announcement" : "New announcement"}</div>
        <label className="field">
          Title
          <input value={draft.title} maxLength={80} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <label className="field">
          Message
          <textarea
            value={draft.body}
            maxLength={1000}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          />
        </label>
        <label className="field">
          Ends (optional)
          <input
            type="date"
            value={draft.endsOn}
            min={nyNow().date}
            onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })}
          />
        </label>
        <p className="tiny muted">Without an end date it stays until each person taps Got it, or you end it.</p>
        {!editing && (
          <label className="radio" style={{ border: 0, padding: 0 }}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <span>
              <b>Also send a notification</b>
              <br />
              <span className="small muted">To everyone with notifications on</span>
            </span>
          </label>
        )}
        {error && (
          <p className="small" role="alert" style={{ color: "var(--no-fg)" }}>
            {error}
          </p>
        )}
        <div className="btnrow">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!draft.title.trim() || !draft.body.trim() || call.isPending}
            onClick={save}
          >
            {editing ? "Save" : "Post to everyone"}
          </button>
          {editing && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setEditing(null);
                setDraft(EMPTY);
              }}
            >
              Cancel
            </button>
          )}
        </div>
        {editing && <p className="tiny muted">People who already tapped Got it aren't shown it again.</p>}
      </div>
      {active.length > 0 && (
        <div className="sub">
          <div className="sub-h">Active</div>
          {active.map(row)}
        </div>
      )}
      {past.length > 0 && (
        <div className="sub">
          <div className="sub-h">Past</div>
          {past.map(row)}
        </div>
      )}
      {who && <NotSeen a={who} onClose={() => setWho(null)} />}
    </Panel>
  );
}

/** Who hasn't tapped Got it on an announcement yet (Admins). */
function NotSeen({ a, onClose }: { a: AnnouncementAdmin; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["announcement-unseen", a.id],
    queryFn: () => api<{ id: string; name: string }[]>(`/announcements/${a.id}/unseen`),
  });
  const people = q.data ?? [];
  return (
    <Sheet label={`Who hasn't seen ${a.title}`} onClose={onClose}>
      <div className="confirm">
        <h2>{a.title}</h2>
        <p>
          <b>
            {a.seenCount} of {a.teamCount}
          </b>{" "}
          got it.{people.length ? ` Not yet (${people.length}):` : ""}
        </p>
        {q.isPending ? (
          <p className="muted small">Loading…</p>
        ) : people.length ? (
          <>
            <div className="plist">
              {people.map((p) => (
                <PersonButton key={p.id} userId={p.id} className="person">
                  {p.name}
                </PersonButton>
              ))}
            </div>
            <p className="tiny muted">Tap a name to call or text.</p>
          </>
        ) : (
          <p className="muted small">Everyone has seen it.</p>
        )}
        <div className="confirm-btns">
          <button type="button" className="linkbtn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Sheet>
  );
}
