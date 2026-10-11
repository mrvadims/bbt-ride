// Riders panel: In / Out (route choice only for In on rides with an alternate) and the ride's message thread.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Me, Message, RideDetail } from "../../shared/api.ts";
import { api } from "../lib/api.ts";
import { Panel } from "./Panel.tsx";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export function Riders({ ride, me, past }: { ride: RideDetail; me: Me; past: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = (data: RideDetail) => {
    qc.setQueryData(["ride", ride.id], data);
    qc.invalidateQueries({ queryKey: ["rides"] });
    setError(null);
  };
  const call = useMutation({
    mutationFn: (req: { path: string; method?: string; body?: unknown }) => api<RideDetail>(req.path, req),
    onSuccess: done,
    onError: (e) => setError(e.message),
  });

  const mine = ride.rsvps.find((r) => r.userId === me.id);
  const alt = ride.routes.length > 1;
  const open = !past && ride.status === "published";
  const rsvp = (status: "in" | "out") => {
    const next = mine?.status === status ? null : status; // tapping the selected answer again clears it
    call.mutate({
      path: `/rides/${ride.id}/rsvp`,
      method: "PUT",
      body: {
        status: next,
        routeLabel: next === "in" && alt ? (mine?.routeLabel ?? ride.routes[0]?.label ?? null) : null,
      },
    });
  };
  const ins = ride.rsvps.filter((r) => r.status === "in");
  const outs = ride.rsvps.filter((r) => r.status === "out");
  const top = ride.messages.filter((m) => !m.parentId);

  const author = (m: Message) => (m.kind !== "user" ? "Ride update" : (m.authorName ?? "Former member"));

  const msg = (m: Message, isReply: boolean) => {
    const canEdit = m.kind === "user" && !m.deleted && m.authorId === me.id && !past;
    const canDelete = m.kind === "user" && !m.deleted && (m.authorId === me.id || me.role !== "view");
    return (
      <div key={m.id} className={`msg${isReply ? " reply" : ""}${m.kind !== "user" ? " sys" : ""}`}>
        <div className="meta">
          <b>{author(m)}</b>{" "}
          <span className="muted">
            {when(m.createdAt)}
            {m.editedAt ? " · edited" : ""}
          </span>
        </div>
        {editing?.id === m.id ? (
          <div className="compose">
            <textarea
              aria-label="Edit message"
              value={editing.body}
              onChange={(e) => setEditing({ id: m.id, body: e.target.value })}
            />
            <div className="btnrow">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  call.mutate({ path: `/messages/${m.id}`, method: "PATCH", body: { body: editing.body } });
                  setEditing(null);
                }}
              >
                Save
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className={m.deleted ? "muted" : undefined}>{m.deleted ? "Message deleted." : m.body}</p>
        )}
        <div className="btnrow msg-actions">
          {!isReply && open && (
            <button type="button" className="linkbtn" onClick={() => setReplyTo(replyTo === m.id ? null : m.id)}>
              Reply
            </button>
          )}
          {canEdit && editing?.id !== m.id && (
            <button type="button" className="linkbtn" onClick={() => setEditing({ id: m.id, body: m.body })}>
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
            {ride.messages.filter((r) => r.parentId === m.id).length > 0 && (
              <div className="replies">{ride.messages.filter((r) => r.parentId === m.id).map((r) => msg(r, true))}</div>
            )}
            {replyTo === m.id && (
              <div className="compose">
                <textarea
                  aria-label={`Reply to ${author(m)}`}
                  placeholder={`Reply to ${author(m)}`}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                />
                <div className="btnrow">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!replyText.trim() || call.isPending}
                    onClick={() =>
                      call.mutate(
                        { path: `/rides/${ride.id}/messages`, body: { body: replyText, parentId: m.id } },
                        {
                          onSuccess: () => {
                            setReplyText("");
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

  const nMsg = ride.messages.filter((m) => !m.deleted).length;
  return (
    <Panel
      id="riders"
      label="Riders"
      summary={
        <>
          <b>
            {ins.length} {past ? (ride.status === "cancelled" ? "were in" : "rode") : "in"}
          </b>{" "}
          · {outs.length} out · {nMsg} message{nMsg === 1 ? "" : "s"}
          {open && (
            <div className="sw">
              <div className="seg" role="group" aria-label="Your RSVP">
                <button type="button" aria-pressed={mine?.status === "in"} onClick={() => rsvp("in")}>
                  In
                </button>
                <button type="button" aria-pressed={mine?.status === "out"} onClick={() => rsvp("out")}>
                  Out
                </button>
              </div>
              {mine?.status === "in" && alt && (
                <div className="seg" role="group" aria-label="Your route" style={{ marginTop: 6 }}>
                  {ride.routes.map((r) => (
                    <button
                      key={r.label}
                      type="button"
                      aria-pressed={mine.routeLabel === r.label}
                      onClick={() =>
                        call.mutate({
                          path: `/rides/${ride.id}/rsvp`,
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
        </>
      }
    >
      {error && (
        <p className="tiny" role="alert" style={{ color: "var(--no-fg)", margin: "0 0 8px" }}>
          {error}
        </p>
      )}
      <div className="people">
        <div>
          <div className="sub-h">In ({ins.length})</div>
          <div className="plist">
            {ins.length ? (
              ins.map((p) => (
                <span key={p.userId} className={`person${p.userId === me.id ? " me" : ""}`}>
                  {p.name}
                  {alt && p.routeLabel ? <span className="muted"> · {p.routeLabel}</span> : null}
                </span>
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
                <span key={p.userId} className={`person${p.userId === me.id ? " me" : ""}`}>
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="sub">
        <div className="sub-h">Messages</div>
        {top.length ? top.map((m) => msg(m, false)) : <p className="muted small">No messages yet.</p>}
        {open && (
          <div className="compose">
            <textarea
              aria-label="Message the team"
              placeholder="Message the team"
              value={draft}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="btnrow">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!draft.trim() || call.isPending}
                onClick={() =>
                  call.mutate(
                    { path: `/rides/${ride.id}/messages`, body: { body: draft } },
                    { onSuccess: () => setDraft("") },
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
