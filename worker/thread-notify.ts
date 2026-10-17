// Message notifications (DESIGN.md → Message notifications): who hears about a new message in a thread, and how. A
// thread's followers are, by default, its owner's creator, the people In (on a date poll: In or Maybe for any date) and
// everyone who posted in it; anyone who can see it can follow it instead, and anyone can mute it. "@here" also reaches
// everyone else who can see it, except people who turned its sport off. @mentions go their own way (the owner's
// route), so the people mentioned aren't told twice. The first new message alerts; later ones update that notification
// quietly ("3 new messages") until the person opens the thread, and an @here always alerts.
import { firstName, mentionIds, mentionsHere, plainMentions } from "../shared/people.ts";
import { notifyPeople, type PushMessage } from "./push.ts";
import type { Owner, OwnerKind } from "./threads.ts";
import { pollVisible, visible } from "./util.ts";

/** Per owner kind (constants only: these go into SQL, with u the person and t the thread): the owner joined to its
 * thread, its id, who may see it, who follows it by default, its sport, and when the person last read the thread. */
const SQL = {
  activity: {
    from: "activities a join threads t on t.activity_id = a.id",
    id: "a.id",
    sees: visible("u.id"),
    follows: `(a.created_by = u.id or exists (select 1 from rsvps v where v.activity_id = a.id and v.user_id = u.id and v.status = 'in'))`,
    sport: "a.sport",
    seen: "(select s.seen_at from activity_seen s where s.user_id = u.id and s.activity_id = a.id)",
  },
  poll: {
    from: "date_polls p join threads t on t.poll_id = p.id",
    id: "p.id",
    sees: pollVisible("u.id"),
    follows: `(p.created_by = u.id or exists (select 1 from date_poll_answers x join date_poll_options o on o.id = x.option_id
       where o.poll_id = p.id and x.user_id = u.id and x.status in ('in', 'maybe')))`,
    sport: "p.sport",
    seen: "(select s.seen_at from thread_seen s where s.thread_id = t.id and s.user_id = u.id)",
  },
} as const satisfies Record<OwnerKind, Record<string, string>>;

/** Whether the person hears about a new message in the thread (tp: their thread_people row): their own choice, else
 * whether they follow it by default; `here` (an @here) adds everyone else who didn't turn its sport off. */
const notified = (kind: OwnerKind, here: string) => `(tp.notify = 1 or (tp.notify is null and (${SQL[kind].follows}
  or exists (select 1 from messages m where m.thread_id = t.id and m.user_id = u.id and m.kind = 'user')
  or (${here} and not exists (select 1 from notify_off n where n.user_id = u.id and n.sport = ${SQL[kind].sport})))))`;

/** Whether `viewer` gets notified about new messages in the owner's thread (the Messages panel's checkbox). */
export async function threadNotify(db: D1Database, owner: Owner, viewer: string): Promise<boolean> {
  const q = SQL[owner.kind];
  const row = await db
    .prepare(
      `select ${notified(owner.kind, "0")} as on_ from ${q.from} join "user" u on u.id = ?2
       left join thread_people tp on tp.thread_id = t.id and tp.user_id = u.id where ${q.id} = ?1`,
    )
    .bind(owner.id, viewer)
    .first<{ on_: number }>();
  return Boolean(row?.on_);
}

/** The checkbox: follow (true) or mute (false) the owner's thread. */
export const setThreadNotify = (db: D1Database, owner: Owner, viewer: string, on: boolean) =>
  db
    .prepare(
      `insert into thread_people (thread_id, user_id, notify) select t.id, ?2, ?3 from ${SQL[owner.kind].from}
       where ${SQL[owner.kind].id} = ?1 on conflict (thread_id, user_id) do update set notify = excluded.notify`,
    )
    .bind(owner.id, viewer, on ? 1 : 0);

export interface Recipient {
  id: string;
  alertedAt: string | null; // when the message that last alerted them was posted
  seenAt: string | null; // when they last opened the activity or poll
}

/** Who gets what (pure, for tests): an alert for those not alerted since they last opened it, or for everyone on an
 * @here; for the rest, a quiet update counting the messages from others since the one that alerted them. */
export function threadSends(
  people: Recipient[],
  here: boolean,
  recent: { userId: string | null; createdAt: string }[],
  m: { who: string; text: string; name: string; url: string; tag: string },
): { loud: string[]; sends: { to: string[]; message: PushMessage }[] } {
  const quiet = here ? [] : people.filter((r) => r.alertedAt && r.alertedAt > (r.seenAt ?? ""));
  const loud = people.filter((r) => !quiet.includes(r)).map((r) => r.id);
  const counts = new Map<number, string[]>();
  for (const r of quiet) {
    const n = 1 + recent.filter((x) => x.createdAt > (r.alertedAt as string) && x.userId !== r.id).length;
    counts.set(n, [...(counts.get(n) ?? []), r.id]);
  }
  const base = { url: m.url, tag: m.tag };
  return {
    loud,
    sends: [
      { to: loud, message: { ...base, title: `${m.who}${here ? " to everyone" : ""} · ${m.name}`, body: m.text } },
      ...[...counts].map(([n, to]) => ({
        to,
        message: { ...base, title: `${n} new messages · ${m.name}`, body: `${m.who}: ${m.text}`, quiet: true },
      })),
    ],
  };
}

/** After a person posted `body` in the owner's thread (`name`: the activity's or poll's name, `url`: its page). */
export async function notifyThread(
  env: Env,
  owner: Owner,
  where: { name: string; url: string },
  author: { id: string; name: string },
  body: string,
): Promise<void> {
  const db = env.DB;
  const q = SQL[owner.kind];
  const here = mentionsHere(body);
  const mentioned = mentionIds(body);
  const [people, names] = await Promise.all([
    db
      .prepare(
        `select u.id, t.id as thread_id, tp.alerted_at, ${q.seen} as seen_at,
                (select max(m.created_at) from messages m where m.thread_id = t.id and m.user_id = ?2) as posted_at
         from ${q.from} join "user" u left join thread_people tp on tp.thread_id = t.id and tp.user_id = u.id
         where ${q.id} = ?1 and u.id != ?2 and coalesce(u.banned, 0) = 0 and ${q.sees}
           and u.id not in (select value from json_each(?3))
           and exists (select 1 from push_subscriptions ps where ps.user_id = u.id)
           and ${notified(owner.kind, "?4")}`,
      )
      .bind(owner.id, author.id, JSON.stringify(mentioned), here ? 1 : 0)
      .all<{ id: string; thread_id: string; alerted_at: string | null; seen_at: string | null; posted_at: string }>(),
    mentioned.length
      ? db
          .prepare(`select id, name from "user" where id in (select value from json_each(?))`)
          .bind(JSON.stringify(mentioned))
          .all<{ id: string; name: string }>()
      : null,
  ]);
  const rows = people.results;
  const first = rows[0];
  if (!first) return;
  const threadId = first.thread_id;
  const nameOf = new Map((names?.results ?? []).map((r) => [r.id, r.name]));
  const recipients = rows.map((r) => ({ id: r.id, alertedAt: r.alerted_at, seenAt: r.seen_at }));
  // the earliest alert among those who'll get a quiet update (threadSends decides the same way)
  const since = here
    ? undefined
    : recipients.flatMap((r) => (r.alertedAt && r.alertedAt > (r.seenAt ?? "") ? [r.alertedAt] : [])).sort()[0];
  const recent = since
    ? (
        await db
          .prepare(
            `select user_id as userId, created_at as createdAt from messages
             where thread_id = ? and kind = 'user' and deleted_at is null and created_at > ?`,
          )
          .bind(threadId, since)
          .all<{ userId: string | null; createdAt: string }>()
      ).results
    : [];
  const { loud, sends } = threadSends(recipients, here, recent, {
    who: firstName(author.name),
    text: plainMentions(body, (id) => (id === author.id ? author.name : nameOf.get(id))).slice(0, 300),
    name: where.name,
    url: where.url,
    tag: `thread-${threadId}`,
  });
  await notifyPeople(env, sends);
  // Recorded once queued: from now on, until they open it, this thread updates their card quietly.
  if (loud.length)
    await db
      .prepare(
        `insert into thread_people (thread_id, user_id, alerted_at) select ?1, value, ?2 from json_each(?3) where true
         on conflict (thread_id, user_id) do update set alerted_at = excluded.alerted_at`,
      )
      .bind(threadId, first.posted_at, JSON.stringify(loud))
      .run();
}
