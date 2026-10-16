// Team directory (DESIGN.md → Team and contacts): everyone on the team, with Call and Text; a row opens the contact card.
import { useState } from "react";
import type { Me, TeamMember } from "../../shared/api.ts";
import { fmtPhone } from "../../shared/people.ts";
import { CallText, ContactCard, ContactForm, Initials } from "../components/Contact.tsx";
import { Sheet } from "../components/Sheet.tsx";
import { useMembers } from "../lib/data.ts";

export function TeamPage({ me }: { me: Me }) {
  const q = useMembers();
  const [search, setSearch] = useState("");
  const [card, setCard] = useState<TeamMember | null>(null);
  const [editing, setEditing] = useState(false);
  const all = (q.data ?? []).filter((m) => m.active);
  const searchable = all.length > 6;
  const words = searchable ? search.trim().toLowerCase().split(/\s+/).filter(Boolean) : [];
  const shown = all.filter((m) => words.every((w) => m.name.toLowerCase().includes(w)));
  return (
    <section className="team">
      <div className="team-h">
        <div className="kicker">Team</div>
        <h1>{q.data ? `${all.length} member${all.length === 1 ? "" : "s"}` : "Team"}</h1>
      </div>
      {searchable && (
        <input
          type="search"
          aria-label="Search by name"
          placeholder="Search by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      {q.isPending && <p className="muted small">Loading…</p>}
      {q.error && <p role="alert">Couldn't load the team: {q.error.message}</p>}
      {q.data && (
        <ul className="panel team-list">
          {shown.map((m) => (
            <li key={m.id}>
              <button type="button" className="team-who" onClick={() => setCard(m)}>
                <Initials name={m.name} />
                <span className="team-text">
                  <b>
                    {m.name}
                    {m.id === me.id && <span className="muted"> (you)</span>}
                  </b>
                  <span className="muted small">{m.phone ? fmtPhone(m.phone) : "No phone yet"}</span>
                </span>
              </button>
              {m.id === me.id ? (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>
                  Edit
                </button>
              ) : (
                m.phone && <CallText phone={m.phone} name={m.name} compact />
              )}
            </li>
          ))}
          {!shown.length && <li className="muted small">No one matches “{search}”.</li>}
        </ul>
      )}
      {card && <ContactCard member={card} onClose={() => setCard(null)} />}
      {editing && (
        <Sheet label="My contact info" onClose={() => setEditing(false)}>
          <ContactForm me={me} onDone={() => setEditing(false)} />
        </Sheet>
      )}
    </section>
  );
}
