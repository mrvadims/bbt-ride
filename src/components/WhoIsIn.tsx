// Who's in panel: In / Out (route choice only for In with an alternate route) and the activity's message thread.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ActivityDetail, Me, Message } from "../../shared/api.ts";
import { FORMER_MEMBER } from "../../shared/people.ts";
import { fmtStamp } from "../../shared/time.ts";
import { api } from "../lib/api.ts";
import { useMembers } from "../lib/data.ts";
import { PersonButton } from "./Contact.tsx";
import { bodyDraft, type Draft, draftBody, EMPTY_DRAFT, MentionBox, MessageText } from "./Mentions.tsx";
import { Panel } from "./Panel.tsx";

export function WhoIsIn({
  act,
  me,
  past,
  since,
}: {
  act: ActivityDetail;
  me: Me;
  past: boolean;
  since?: string | null; // when the viewer last caught up; undefined: no "new" divider
}) {
  const qc = useQueryClient();
  const members = useMembers().data;
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Draft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<{ id: string; body: Draft } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = (data: ActivityDetail) => {
    qc.setQueryData(["activity", act.id], data);
    qc.invalidateQueries({ queryKey: ["activities"] });
    setError(null);
  };
  const call = useMutation({
    mutationFn: (req: { path: string; method?: string; body?: unknown }) => api<ActivityDetail>(req.path, req),
    onSuccess: done,
    onError: (e) => setError(e.message),
  });

  const mine = act.rsvps.find((r) => r.userId === me.id);
  const alt = act.routes.length > 1;
  const open = !past && act.status === "published";
  const rsvp = (status: "in" | "out") => {
    const next = mine?.status === status ? null : status; // tapping the selected answer again clears it
    call.mutate({
      path: `/activities/${act.id}/rsvp`,
      method: "PUT",
      body: {
        status: next,
        routeLabel: next === "in" && alt ? (mine?.routeLabel ?? act.routes[0]?.label ?? null) : null,
      },
    });
  };
  const ins = act.rsvps.filter((r) => r.status === "in");
  const outs = act.rsvps.filter((r) => r.status === "out");
  // A private activity lists the people invited who haven't answered, and only they can be mentioned.
  const invited = act.private ? act.guests.map((g) => g.userId) : undefined;
  const notYet = act.guests.filter((g) => !act.rsvps.some((r) => r.userId === g.userId));
  const top = act.messages.filter((m) => !m.parentId);
  // Other people's messages since the viewer last caught up; the divider goes before the first of them.
  const fresh =
    since === undefined
      ? []
      : act.messages.filter(
          (m) => m.kind === "user" && !m.deleted && m.authorId !== me.id && (since === null || m.createdAt > since),
        );
  const firstNew = fresh[0]?.id;

  const author = (m: Message) => (m.kind !== "user" ? "Update" : (m.authorName ?? FORMER_MEMBER));

  const msg = (m: Message, isReply: boolean) => {
    const replies = isReply ? [] : act.messages.filter((r) => r.parentId === m.id);
    const canEdit = m.kind === "user" && !m.deleted && m.authorId === me.id && open && Boolean(members); // names for mentions
    // Authors delete their own on upcoming activities; editors and admins can always delete (moderation).
    const canDelete = m.kind === "user" && !m.deleted && (me.role !== "view" || (m.authorId === me.id && !past));
    return (
      <div key={m.id} className={`msg${isReply ? " reply" : ""}${m.kind !== "user" ? " sys" : ""}`}>
        {m.id === firstNew && (
          <div className="newline" role="separator">
            <span>{fresh.length} new</span>
          </div>
        )}
        <div className="meta">
          <b>{author(m)}</b>{" "}
          <span className="muted">
            {fmtStamp(m.createdAt)}
            {m.editedAt ? " · edited" : ""}
          </span>
        </div>
        {editing?.id === m.id ? (
          <div className="compose">
            <MentionBox
              only={invited}
              label="Edit message"
              meId={me.id}
              value={editing.body}
              onChange={(d) => setEditing({ id: m.id, body: d })}
            />
            <div className="btnrow">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!editing.body.text.trim() || call.isPending}
                onClick={() =>
                  call.mutate(
                    { path: `/messages/${m.id}`, method: "PATCH", body: { body: draftBody(editing.body) } },
                    { onSuccess: () => setEditing(null) }, // a failed save keeps the text
                  )
                }
              >
                Save
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className={m.deleted ? "muted" : undefined}>
            {m.deleted ? "Message deleted." : m.kind === "user" ? <MessageText body={m.body} meId={me.id} /> : m.body}
          </p>
        )}
        <div className="btnrow msg-actions">
          {!isReply && open && (
            <button type="button" className="linkbtn" onClick={() => setReplyTo(replyTo === m.id ? null : m.id)}>
              Reply
            </button>
          )}
          {canEdit && editing?.id !== m.id && (
            <button
              type="button"
              className="linkbtn"
              onClick={() => members && setEditing({ id: m.id, body: bodyDraft(m.body, members) })}
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="linkbtn"
              onClick={() =>
                window.confirm("Delete this message?") && call.mutate({ path: `/messages/${m.id}`, method: "DELETE" })
              }
            >
              Delete
            </button>
          )}
        </div>
        {!isReply && (
          <>
            {replies.length > 0 && <div className="replies">{replies.map((r) => msg(r, true))}</div>}
            {replyTo === m.id && (
              <div className="compose">
                <MentionBox
                  only={invited}
                  label={`Reply to ${author(m)}`}
                  placeholder={`Reply to ${author(m)}`}
                  meId={me.id}
                  value={replyText}
                  onChange={setReplyText}
                />
                <div className="btnrow">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!replyText.text.trim() || call.isPending}
                    onClick={() =>
                      call.mutate(
                        {
                          path: `/activities/${act.id}/messages`,
                          body: { body: draftBody(replyText), parentId: m.id },
                        },
                        {
                          onSuccess: () => {
                            setReplyText(EMPTY_DRAFT);
                            setReplyTo(null);
                          },
                        },
                      )
                    }
                  >
                    Send
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setReplyTo(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const nMsg = act.messages.filter((m) => !m.deleted).length;
  return (
    <Panel
      id="people"
      label="Who's in"
      summary={
        <>
          <b>
            {ins.length} {past ? (act.status === "cancelled" ? "were in" : "joined") : "in"}
          </b>{" "}
          · {outs.length} out{!past && notYet.length > 0 ? ` · ${notYet.length} not yet` : ""} · {nMsg} message
          {nMsg === 1 ? "" : "s"}
          {fresh.length > 0 && <b className="unseen"> · {fresh.length} new</b>}
          {open && (
            <div className="sw">
              <div className="seg" role="group" aria-label="Your RSVP">
                <button
                  type="button"
                  aria-pressed={mine?.status === "in"}
                  disabled={call.isPending}
                  onClick={() => rsvp("in")}
                >
                  In
                </button>
                <button
                  type="button"
                  aria-pressed={mine?.status === "out"}
                  disabled={call.isPending}
                  onClick={() => rsvp("out")}
                >
                  Out
                </button>
              </div>
              {mine?.status === "in" && alt && (
                <div className="seg" role="group" aria-label="Your route" style={{ marginTop: 6 }}>
                  {act.routes.map((r) => (
                    <button
                      key={r.label}
                      type="button"
                      aria-pressed={mine.routeLabel === r.label}
                      disabled={call.isPending}
                      onClick={() =>
                        call.mutate({
                          path: `/activities/${act.id}/rsvp`,
                          method: "PUT",
                          body: { status: "in", routeLabel: r.label },
                        })
                      }
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {error && ( // in the header, so a failed In / Out shows even while the panel is closed
            <p className="tiny" role="alert" style={{ color: "var(--no-fg)", margin: "6px 0 0" }}>
              {error}
            </p>
          )}
        </>
      }
    >
      <div className="people">
        <div>
          <div className="sub-h">In ({ins.length})</div>
          {ins.length > 0 && <p className="tiny muted plist-hint">Tap a name to call or text.</p>}
          <div className="plist">
            {ins.length ? (
              ins.map((p) => (
                <PersonButton key={p.userId} userId={p.userId} className={`person${p.userId === me.id ? " me" : ""}`}>
                  {p.name}
                  {alt && p.routeLabel ? <span className="muted"> · {p.routeLabel}</span> : null}
                </PersonButton>
              ))
            ) : (
              <span className="muted small">No one yet</span>
            )}
          </div>
        </div>
        {outs.length > 0 && (
          <div>
            <div className="sub-h">Out ({outs.length})</div>
            <div className="plist">
              {outs.map((p) => (
                <PersonButton key={p.userId} userId={p.userId} className={`person${p.userId === me.id ? " me" : ""}`}>
                  {p.name}
                </PersonButton>
              ))}
            </div>
          </div>
        )}
        {notYet.length > 0 && (
          <div>
            <div className="sub-h">Not answered yet ({notYet.length})</div>
            <div className="plist">
              {notYet.map((p) => (
                <PersonButton
                  key={p.userId}
                  userId={p.userId}
                  className={`person quiet${p.userId === me.id ? " me" : ""}`}
                >
                  {p.name}
                </PersonButton>
              ))}
            </div>
          </div>
        )}
        {act.private && (
          <p className="tiny muted" style={{ margin: 0 }}>
            Private: only the {act.guests.length} people invited see this.
          </p>
        )}
      </div>
      <div className="sub">
        <div className="sub-h">Messages</div>
        {top.length ? top.map((m) => msg(m, false)) : <p className="muted small">No messages yet.</p>}
        {open && (
          <div className="compose">
            <MentionBox
              only={invited}
              label={act.private ? "Message the group" : "Message the team"}
              placeholder={`Message the ${act.private ? "group" : "team"} · @ to mention`}
              meId={me.id}
              value={draft}
              onChange={setDraft}
            />
            <div className="btnrow">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!draft.text.trim() || call.isPending}
                onClick={() =>
                  call.mutate(
                    { path: `/activities/${act.id}/messages`, body: { body: draftBody(draft) } },
                    { onSuccess: () => setDraft(EMPTY_DRAFT) },
                  )
                }
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
