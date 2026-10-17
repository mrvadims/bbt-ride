// Messages panel (DESIGN.md → Messages): a thread with one level of replies, @mentions, edit and delete. Its owner's page
// (an activity today) passes the messages, where new ones go, and what to do with the owner as the server sends it back.

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { Me, Message } from "../../shared/api.ts";
import { FORMER_MEMBER, plainMentions } from "../../shared/people.ts";
import { fmtStamp } from "../../shared/time.ts";
import { api } from "../lib/api.ts";
import { useMembers } from "../lib/data.ts";
import { bodyDraft, type Draft, draftBody, EMPTY_DRAFT, MentionBox, MessageText } from "./Mentions.tsx";
import { Panel } from "./Panel.tsx";

export function MessagesPanel({
  id,
  messages,
  me,
  canPost,
  past,
  postPath,
  onData,
  only,
  group,
  since,
}: {
  id: string; // the panel's id, for its remembered open state
  messages: Message[];
  me: Me;
  canPost: boolean; // replying, posting and editing are open
  past: boolean; // authors can't delete their own on past ones (editors and admins always can)
  postPath: string; // POST here with { body, parentId }
  onData: (owner: unknown) => void; // every call answers with the owner as it now is
  only?: string[]; // who can be mentioned (the people invited to something private)
  group: boolean; // "Message the group" rather than "the team"
  since?: string | null; // when the viewer last caught up; undefined: no "new" divider
}) {
  const members = useMembers().data;
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Draft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<{ id: string; body: Draft } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const call = useMutation({
    mutationFn: (req: { path: string; method?: string; body?: unknown }) => api<unknown>(req.path, req),
    onSuccess: (data) => {
      onData(data);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const top = messages.filter((m) => !m.parentId);
  // Other people's messages since the viewer last caught up; the divider goes before the first of them.
  const fresh =
    since === undefined
      ? []
      : messages.filter(
          (m) => m.kind === "user" && !m.deleted && m.authorId !== me.id && (since === null || m.createdAt > since),
        );
  const firstNew = fresh[0]?.id;
  const author = (m: Message) => (m.kind !== "user" ? "Update" : (m.authorName ?? FORMER_MEMBER));
  const latest = messages.findLast((m) => m.kind === "user" && !m.deleted);
  const names = new Map((members ?? []).map((p) => [p.id, p.name]));

  const msg = (m: Message, isReply: boolean) => {
    const replies = isReply ? [] : messages.filter((r) => r.parentId === m.id);
    const canEdit = m.kind === "user" && !m.deleted && m.authorId === me.id && canPost && Boolean(members); // names for mentions
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
              only={only}
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
          {!isReply && canPost && (
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
                  only={only}
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
                        { path: postPath, body: { body: draftBody(replyText), parentId: m.id } },
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

  const n = messages.filter((m) => m.kind === "user" && !m.deleted).length;
  return (
    <Panel
      id={id}
      label="Messages"
      expanded
      summary={(open) => (
        <>
          {n ? `${n} message${n === 1 ? "" : "s"}` : "No messages yet"}
          {fresh.length > 0 && <b className="unseen"> · {fresh.length} new</b>}
          {!open && latest && (
            <span className="clamp msg-latest">
              <b>{author(latest)}:</b> {plainMentions(latest.body, (uid) => names.get(uid))}
            </span>
          )}
          {error && ( // in the header, so a failed delete shows even while the panel is closed
            <p className="tiny" role="alert" style={{ color: "var(--no-fg)", margin: "6px 0 0" }}>
              {error}
            </p>
          )}
        </>
      )}
    >
      {top.length ? top.map((m) => msg(m, false)) : <p className="muted small">No messages yet.</p>}
      {canPost && (
        <div className="compose">
          <MentionBox
            only={only}
            label={group ? "Message the group" : "Message the team"}
            placeholder={`Message the ${group ? "group" : "team"} · @ to mention`}
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
                  { path: postPath, body: { body: draftBody(draft) } },
                  { onSuccess: () => setDraft(EMPTY_DRAFT) },
                )
              }
            >
              Send
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}
