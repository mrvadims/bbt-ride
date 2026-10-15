// New, changed and unread markers (DESIGN.md → New and unread): when each person last opened each activity, and what
// arrived since from other people. Before someone first opens an activity, their baseline stands in, so everything that
// existed when markers started counts as seen.
import type { Unseen } from "../shared/api.ts";
import { firstName } from "../shared/people.ts";
import { nowIso, sameBatch } from "./util.ts";

/** The person's baseline, made the first time they're asked about. */
async function baseline(db: D1Database, userId: string): Promise<string> {
  await db
    .prepare("insert into seen_baseline (user_id, at) values (?, ?) on conflict do nothing")
    .bind(userId, nowIso())
    .run();
  const row = await db.prepare("select at from seen_baseline where user_id = ?").bind(userId).first<{ at: string }>();
  return row?.at ?? nowIso();
}

/** Markers for every upcoming activity (date >= today) the person hasn't caught up on. */
export async function markers(db: D1Database, userId: string, today: string): Promise<Map<string, Unseen>> {
  const since = await baseline(db, userId);
  const seen = `coalesce((select s.seen_at from activity_seen s where s.user_id = ?1 and s.activity_id = a.id), ?2)`;
  // Only activities the person may see (routes/activities.ts → VISIBLE, with the user as ?1).
  const visible = `(a.private = 0 or exists (select 1 from activity_guests g where g.activity_id = a.id and g.user_id = ?1))`;
  const [made, msgs, notes, mine] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `select a.id, a.created_at, a.created_by, u.name from activities a left join "user" u on u.id = a.created_by
         where a.date >= ?3 and ${visible} and a.created_by is not ?1 and a.created_at > ?2
           and not exists (select 1 from activity_seen s where s.user_id = ?1 and s.activity_id = a.id)`,
      )
      .bind(userId, since, today),
    db
      .prepare(
        `select m.activity_id, u.name from messages m join activities a on a.id = m.activity_id
         left join "user" u on u.id = m.user_id
         where a.date >= ?3 and ${visible} and m.kind = 'user' and m.deleted_at is null and m.user_id is not ?1 and m.created_at > ${seen}
         order by m.created_at`,
      )
      .bind(userId, since, today),
    db
      .prepare(
        `select m.activity_id, m.kind, m.body, m.created_at from messages m join activities a on a.id = m.activity_id
         where a.date >= ?3 and ${visible} and m.kind != 'user' and m.created_at > ${seen} order by m.created_at`,
      )
      .bind(userId, since, today),
    db
      .prepare(
        `select l.entity_id, l.at from audit_log l join activities a on a.id = l.entity_id
         where l.entity = 'activity' and l.user_id = ?1 and a.date >= ?2`,
      )
      .bind(userId, today),
  ]);
  const out = new Map<string, Unseen>();
  const get = (id: string) => {
    const u = out.get(id) ?? { isNew: false, by: null, change: null, messages: 0, from: [] };
    out.set(id, u);
    return u;
  };
  for (const r of (made?.results ?? []) as { id: string; name: string | null }[]) {
    const u = get(r.id);
    u.isNew = true;
    u.by = r.name;
  }
  for (const r of (msgs?.results ?? []) as { activity_id: string; name: string | null }[]) {
    const u = get(r.activity_id);
    u.messages++;
    const name = r.name ? firstName(r.name) : "a former member";
    if (!u.from.includes(name)) u.from.push(name);
  }
  // The latest change note since, unless the person made that change themselves.
  const own = (mine?.results ?? []) as { entity_id: string; at: string }[];
  for (const r of (notes?.results ?? []) as { activity_id: string; kind: string; body: string; created_at: string }[]) {
    if (own.some((o) => o.entity_id === r.activity_id && sameBatch(o.at, r.created_at))) continue;
    const u = get(r.activity_id);
    if (u.isNew) continue; // a new activity's own story is "New"
    u.change = r.kind === "update" ? `Changed: ${r.body}` : r.kind === "cancel" ? "Cancelled" : "Back on";
  }
  return out;
}

/** When the person last caught up on this activity (their last visit, or a change they made since), then records this
 * visit. Null when it's new to them, so everything in it counts as unread. */
export async function visit(db: D1Database, userId: string, activityId: string): Promise<string | null> {
  const since = await baseline(db, userId);
  const [prev, act, mine] = await Promise.all([
    db
      .prepare("select seen_at from activity_seen where user_id = ? and activity_id = ?")
      .bind(userId, activityId)
      .first<{ seen_at: string }>(),
    db.prepare("select created_at, created_by from activities where id = ?").bind(activityId).first<{
      created_at: string;
      created_by: string | null;
    }>(),
    db
      .prepare("select max(at) as at from audit_log where entity = 'activity' and entity_id = ? and user_id = ?")
      .bind(activityId, userId)
      .first<{ at: string | null }>(),
  ]);
  await db
    .prepare(
      "insert into activity_seen (user_id, activity_id, seen_at) values (?, ?, ?) on conflict (user_id, activity_id) do update set seen_at = excluded.seen_at",
    )
    .bind(userId, activityId, nowIso())
    .run();
  const isNew = !prev && act && act.created_by !== userId && act.created_at > since;
  const last = isNew ? null : (prev?.seen_at ?? since);
  return [last, mine?.at ?? null].reduce<string | null>((a, b) => (a && b ? (a > b ? a : b) : (a ?? b)), null);
}
