// Plan's Visibility panel (DESIGN.md → Private activities): Public, or Private with the people invited. The server adds
// the creator, keeps the creator and the person editing on the list, and never makes a public activity private.
import { useState } from "react";
import { useMembers } from "../lib/data.ts";

export function Visibility({
  guests,
  onChange,
  meId,
  creatorId,
  original,
}: {
  guests: string[] | null; // null: public
  onChange: (guests: string[] | null) => void;
  meId: string;
  creatorId: string | null; // editing: the creator, who stays invited; a new plan: the editor
  original: string[] | null; // editing a private activity: its saved guest list (else null: it's new)
}) {
  const members = useMembers().data ?? [];
  const [q, setQ] = useState("");
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "Former member";
  const fixed = (id: string) => id === meId || id === creatorId; // can't be taken off
  const editing = original !== null;

  if (editing && guests === null)
    return (
      <div className="vis">
        <b>Public once you update</b>
        <p className="tiny muted">The whole team will see it. It can't be made private again.</p>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange(original)}>
          Keep it private
        </button>
      </div>
    );

  const chosen = guests ?? [];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = members
    .filter((m) => m.active && !fixed(m.id))
    .filter((m) => words.every((w) => m.name.toLowerCase().includes(w)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (id: string) => onChange(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  const shown = [...new Set([...(creatorId ? [creatorId] : []), meId, ...chosen])];

  return (
    <div className="vis">
      {!editing && (
        <div role="radiogroup" aria-label="Visibility">
          <label className="radio">
            <input type="radio" name="visibility" checked={guests === null} onChange={() => onChange(null)} />
            <span>
              <b>Public</b>
              <br />
              <span className="small muted">The whole team sees it.</span>
            </span>
          </label>
          <label className="radio">
            <input type="radio" name="visibility" checked={guests !== null} onChange={() => onChange(chosen)} />
            <span>
              <b>Private</b>
              <br />
              <span className="small muted">Only the people you invite see it, and they're notified.</span>
            </span>
          </label>
        </div>
      )}
      {guests !== null && (
        <>
          {editing && <b>Private · {shown.length} people</b>}
          <div className="plist">
            {shown.map((id) =>
              fixed(id) ? (
                <span key={id} className="person me">
                  {id === meId ? "You" : name(id)}
                  {editing && id === creatorId ? " · created it" : ""}
                </span>
              ) : (
                <button
                  key={id}
                  type="button"
                  className="person"
                  aria-label={`Remove ${name(id)}`}
                  onClick={() => toggle(id)}
                >
                  {name(id)} <span className="muted">✕</span>
                </button>
              ),
            )}
          </div>
          <input
            type="search"
            aria-label="Invite people"
            placeholder="Invite people"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="vis-list">
            {list.length ? (
              list.map((m) => (
                <label key={m.id} className="radio">
                  <input type="checkbox" checked={chosen.includes(m.id)} onChange={() => toggle(m.id)} />
                  {m.name}
                </label>
              ))
            ) : (
              <span className="small muted">No one matches.</span>
            )}
          </div>
          <p className="tiny muted">
            People you invite are notified{editing ? "; people you remove stop seeing it" : ""}. Editors you invite can
            edit it too.
          </p>
          {editing && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange(null)}>
              Make public
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Private with no one invited but the creator and the editor: Publish waits until someone is picked. */
export const nobodyInvited = (guests: string[] | null, meId: string, creatorId: string | null) =>
  guests !== null && !guests.some((id) => id !== (creatorId ?? meId));
