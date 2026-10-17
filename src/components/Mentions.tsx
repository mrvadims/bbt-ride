// @mentions (DESIGN.md → Mentions): a message box with a team picker, and message text that shows mentions and links.
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { MESSAGE_MAX, type TeamMember } from "../../shared/api.ts";
import {
  encodeMentions,
  FORMER_MEMBER,
  HERE,
  mentionIds,
  mentionsHere,
  plainMentions,
  splitMentions,
} from "../../shared/people.ts";
import { useMembers } from "../lib/data.ts";
import { Initials } from "./Contact.tsx";
import { Linkified } from "./Linkified.tsx";

/** What a message box holds: the text as typed ("@Jo Park" for a mention) and the people picked into it. */
export interface Draft {
  text: string;
  picked: { id: string; name: string }[];
}
export const EMPTY_DRAFT: Draft = { text: "", picked: [] };
/** The body to send: picked names become mention tokens. */
export const draftBody = (d: Draft) => encodeMentions(d.text.trim(), d.picked);
/** A stored body back into a draft, for editing (once the team list has loaded; a deleted account's mention becomes
 * plain text). */
export function bodyDraft(body: string, members: TeamMember[]): Draft {
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name;
  return {
    text: plainMentions(body, nameOf),
    picked: [
      ...(mentionsHere(body) ? [{ id: HERE, name: HERE }] : []),
      ...mentionIds(body).flatMap((id) => {
        const name = nameOf(id);
        return name ? [{ id, name }] : [];
      }),
    ],
  };
}

const MAX_SHOWN = 6;
/** The "@query" just before the caret, if the person is typing a mention. */
function typing(text: string, caret: number): { at: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1] ?? ""))) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || /\s\s/.test(query)) return null;
  return { at, query };
}

export function MentionBox({
  value,
  onChange,
  label,
  placeholder,
  meId,
  only,
  here: offerHere = true,
}: {
  value: Draft;
  onChange: (d: Draft) => void;
  label: string;
  placeholder?: string;
  meId: string;
  only?: string[]; // a private activity: only the people invited can be mentioned
  here?: boolean; // offer @here (not when editing: edits never notify)
}) {
  const members = useMembers().data ?? [];
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [mention, setMention] = useState<{ at: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const words = mention?.query.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  const matches = mention
    ? members
        .filter((m) => m.active && m.id !== meId && (!only || only.includes(m.id)))
        .filter((m) => {
          const parts = m.name.toLowerCase().split(/\s+/);
          return words.every((w, i) => parts.some((p, j) => j >= i && p.startsWith(w)));
        })
        .slice(0, MAX_SHOWN)
    : [];
  // "@here" first from "@h" on, while what's typed could still be it (a bare "@" + Enter still picks a person)
  const here = offerHere && mention !== null && mention.query !== "" && HERE.startsWith(mention.query.toLowerCase());
  const options: { id: string; name: string }[] = [...(here ? [{ id: HERE, name: HERE }] : []), ...matches];
  const open = options.length > 0;

  const update = (text: string, caret: number) => {
    onChange({ ...value, text });
    setMention(typing(text, caret));
    setActive(0);
  };
  const pick = (m: { id: string; name: string }) => {
    if (!mention) return;
    const end = mention.at + 1 + mention.query.length;
    const insert = `@${m.name} `;
    const text = value.text.slice(0, mention.at) + insert + value.text.slice(end);
    onChange({
      text,
      picked: value.picked.some((p) => p.id === m.id) ? value.picked : [...value.picked, { id: m.id, name: m.name }],
    });
    setMention(null);
    const caret = mention.at + insert.length;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const m = options[active];
      if (m) pick(m);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMention(null);
    }
  };

  return (
    <div className="mentionbox">
      {open && (
        <div className="mention-list" role="listbox" id={listId} aria-label="Mention someone">
          {options.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              onPointerDown={(e) => e.preventDefault()} // keep the caret in the box
              onClick={() => pick(m)}
            >
              {m.id === HERE ? (
                <span className="mention-here">
                  <b>@here</b>
                  <span className="tiny muted">Notify everyone who can see this</span>
                </span>
              ) : (
                <>
                  <Initials name={m.name} />
                  <b>{m.name}</b>
                </>
              )}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        aria-label={label}
        placeholder={placeholder}
        value={value.text}
        maxLength={MESSAGE_MAX}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        onChange={(e) => update(e.target.value, e.target.selectionStart)}
        onKeyDown={onKey}
        onBlur={() => setMention(null)}
      />
    </div>
  );
}

/** A message's text: mentions as "@Name" (highlighted more when it's you) and tappable links. */
export function MessageText({ body, meId }: { body: string; meId: string }) {
  const members = useMembers().data;
  return (
    <>
      {splitMentions(body).map((p, i) =>
        "mention" in p ? (
          <span key={i} className={`mention${p.mention === meId ? " me" : ""}`}>
            @{p.mention === HERE ? HERE : (members?.find((m) => m.id === p.mention)?.name ?? FORMER_MEMBER)}
          </span>
        ) : (
          <Linkified key={i} text={p.text} />
        ),
      )}
    </>
  );
}
