// Message notifications (DESIGN.md → Message notifications): who hears about a new message in a thread, and how. A
// thread's followers are, by default, its owner's creator, the people In (on a date poll: In or Maybe for any date) and
// everyone who posted in it, unless they muted the thread or its sport; anyone who can see it can follow it instead.
// "@here" reaches everyone who can see it (not people who muted the thread or its sport). @mentions go their own way
// (the owner's route), so the people mentioned aren't told twice. The first new message alerts; later ones update that
// notification quietly ("3 new messages") until the person opens the thread, and an @here always alerts.
import { firstName, mentionIds, mentionsHere, plainMentions } from "../shared/people.ts";
import { notifyPeople } from "./push.ts";
import type { Owner, OwnerKind } from "./threads.ts";
import { nowIso, pollVisible, visible } from "./util.ts";

/** Per owner kind (constants only: these go into SQL, with u the person and t the thread): the owner joined to its
 * thread, who may see it, who follows it by default, its sport, and when the person last read the thread. */
const SQL = {
  activity: {
    from: "activities a join threads t on t.activity_id = a.id",
    sees: visible("u.id"),
    follows: `(a.created_by = u.id or exists (select 1 from rsvps v where v.activity_id = a.id and v.user_id = u.id and v.status = 'in'))`,
    sport: "a.sport",
    seen: "(select s.seen_at from activity_seen s where s.user_id = u.id and s.activity_id = a.id)",
  },
  poll: {
    from: "date_polls p join threads t on t.poll_id = p.id",
    sees: pollVisible("u.id"),
    follows: `(p.created_by = u.id or exists (select 1 from date_poll_answers x join date_poll_options o on o.id = x.option_id
       where o.poll_id = p.id and x.user_id = u.id and x.status in ('in', 'maybe')))`,
    sport: "p.sport",
    seen: "(select s.seen_at from thread_seen s where s.thread_id = t.id and s.user_id = u.id)",
  },
} as const satisfies Record<OwnerKind, Record<string, string>>;
const ID = { activity: "a.id", poll: "p.id" } as const;

/** Whether the person gets notified about new messages in the thread (tp: their thread_people row): their own choice,
 * else the default, unless they muted its sport. `here` widens the default to everyone who can see it. */
const notified = (kind: OwnerKind, here: string) => `(tp.notify = 1 or (tp.notify is null
  and (${here} or ${SQL[kind].follows}
       or exists (select 1 from messages m where m.thread_id = t.id and m.user_id = u.id and m.kind = 'user'))
  and not exists (select 1 from notify_off n where n.user_id = u.id and n.sport = ${SQL[kind].sport})))`;

/** Whether `viewer` gets notified about new messages in the owner's thread (the Messages panel's switch). */
export async function threadNotify(db: D1Database, owner: Owner, viewer: string): Promise<boolean> {
  const q = SQL[owner.kind];
  const row = await db
    .prepare(
      `select ${notified(owner.kind, "0")} as on_ from ${q.from} join "user" u on u.id = ?2
       left join thread_people tp on tp.thread_id = t.id and tp.user_id = u.id where ${ID[owner.kind]} = ?1`,
    )
    .bind(owner.id, viewer)
    .first<{ on_: number }>();
  return Boolean(row?.on_);
}

/** The switch: follow (true) or mute (false) the owner's thread. */
export const setThreadNotify = (db: D1Database, owner: Owner, viewer: string, on: boolean) =>
  db
    .prepare(
      `insert into thread_people (thread_id, user_id, notify) select t.id, ?2, ?3 from ${SQL[owner.kind].from}
       where ${ID[owner.kind]} = ?1 on conflict (thread_id, user_id) do update set notify = excluded.notify`,
    )
    .bind(owner.id, viewer, on ? 1 : 0);

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
        `select u.id, t.id as thread_id, tp.alerted_at, ${q.seen} as seen_at
         from ${q.from} join "user" u left join thread_people tp on tp.thread_id = t.id and tp.user_id = u.id
         where ${ID[owner.kind]} = ?1 and u.id != ?2 and coalesce(u.banned, 0) = 0 and ${q.sees}
           and u.id not in (select value from json_each(?3))
           and exists (select 1 from push_subscriptions ps where ps.user_id = u.id)
           and ${notified(owner.kind, "?4")}`,
      )
      .bind(owner.id, author.id, JSON.stringify(mentioned), here ? 1 : 0)
      .all<{ id: string; thread_id: string; alerted_at: string | null; seen_at: string | null }>(),
    mentioned.length
      ? db
          .prepare(`select id, name from "user" where id in (select value from json_each(?))`)
          .bind(JSON.stringify(mentioned))
          .all<{ id: string; name: string }>()
      : null,
  ]);
  const rows = people.results;
  if (!rows.length) return;
  const threadId = rows[0]?.thread_id as string;
  const nameOf = new Map((names?.results ?? []).map((r) => [r.id, r.name]));
  const text = plainMentions(body, (id) => (id === author.id ? author.name : nameOf.get(id))).slice(0, 300);
  const who = firstName(author.name);
  const tag = `thread-${threadId}`;

  // Alerted since they last read it: this one updates that notification quietly, with how many arrived since.
  const quiet = here ? [] : rows.filter((r) => r.alerted_at && r.alerted_at > (r.seen_at ?? ""));
  const loud = rows.filter((r) => !quiet.includes(r));
  const since = quiet.reduce((m, r) => ((r.alerted_at as string) < m ? (r.alerted_at as string) : m), "9");
  const recent = quiet.length
    ? (
        await db
          .prepare(
            `select user_id, created_at from messages
             where thread_id = ? and kind = 'user' and deleted_at is null and created_at >= ?`,
          )
          .bind(threadId, since)
          .all<{ user_id: string | null; created_at: string }>()
      ).results
    : [];
  const counts = new Map<number, string[]>();
  for (const r of quiet) {
    // the one that alerted came just before alerted_at; these are the ones since, this one included
    const n = 1 + recent.filter((m) => m.created_at >= (r.alerted_at as string) && m.user_id !== r.id).length;
    counts.set(n, [...(counts.get(n) ?? []), r.id]);
  }

  const sends = [
    {
      to: loud.map((r) => r.id),
      message: { title: `${who}${here ? " to everyone" : ""} · ${where.name}`, body: text, url: where.url, tag },
    },
    ...[...counts].map(([n, to]) => ({
      to,
      message: {
        title: `${n} new messages · ${where.name}`,
        body: `${who}: ${text}`,
        url: where.url,
        tag,
        quiet: true,
      },
    })),
  ];
  await Promise.all([
    notifyPeople(env, sends),
    loud.length
      ? db
          .prepare(
            `insert into thread_people (thread_id, user_id, alerted_at) select ?1, value, ?2 from json_each(?3) where true
             on conflict (thread_id, user_id) do update set alerted_at = excluded.alerted_at`,
          )
          .bind(threadId, nowIso(), JSON.stringify(loud.map((r) => r.id)))
          .run()
      : null,
  ]);
}
