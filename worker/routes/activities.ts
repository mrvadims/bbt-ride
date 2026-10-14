// Activities (rides, runs, swims…), RSVPs and messages (DESIGN.md → Rides, Plan a ride, v2).
import { Hono } from "hono";
import {
  type Activity,
  type ActivityDetail,
  type ActivityValues,
  activityInput,
  activityName,
  activityUpdate,
  type HistoryEntry,
  type Message,
  messageEdit,
  messageInput,
  type RecordedWeather,
  type Rsvp,
  rsvpInput,
} from "../../shared/api.ts";
import { mentionIds, plainMentions } from "../../shared/people.ts";
import type { RideRoute } from "../../shared/ride.ts";
import type { Icon } from "../../shared/sport-icons.ts";
import { hasRoute, minPerMile, SPORT_LABEL, type Sport } from "../../shared/sports.ts";
import { dayLabel, fmtTime, hhmmToMin, nyNow } from "../../shared/time.ts";
import { type AppEnv, can, requireRole } from "../app.ts";
import { notifyActivity } from "../push.ts";
import { markers, visit } from "../seen.ts";
import { audit, fail, newId, nowIso } from "../util.ts";
import { validate } from "../validate.ts";
import { loadSettings } from "./settings.ts";

interface ActivityRow {
  id: string;
  sport: Sport;
  icon: Icon | null;
  title: string;
  date: string;
  start_time: string;
  end_time: string | null;
  spot_id: string;
  outdoor: number;
  pace_mph: number;
  details: string;
  notes: string;
  status: "published" | "cancelled";
  updated_at: string;
  observed_json: string | null;
}

/** Summaries of the activities matching `where` (a condition on table alias a), with routes, counts and the latest
 * update. */
export async function summaries(
  db: D1Database,
  where: string,
  binds: unknown[],
  order = "a.date, a.start_time, a.created_at",
  limit?: number,
): Promise<Activity[]> {
  // a.id last: the limited list must come out the same in the subqueries below, even when dates and times tie.
  const pick = `from activities a where ${where} order by ${order}, a.id${limit ? ` limit ${limit}` : ""}`;
  const { results: rows } = await db
    .prepare(
      `select a.id, a.sport, a.icon, a.title, a.date, a.start_time, a.end_time, a.spot_id, a.outdoor, a.pace_mph, a.details,
              a.notes, a.status, a.updated_at, a.observed_json ${pick}`,
    )
    .bind(...binds)
    .all<ActivityRow>();
  if (!rows.length) return [];
  // The same activities again as a subquery: D1 binds at most 100 variables, so no list of ids.
  const marks = `select a.id ${pick}`;
  const [routes, rsvps, msgs, updates] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `select ar.activity_id, ar.label, ar.rwgps_route_id, ar.stop_poi, rc.name from activity_routes ar
         left join route_cache rc on rc.rwgps_route_id = ar.rwgps_route_id
         where ar.activity_id in (${marks}) order by ar.activity_id, ar.sort`,
      )
      .bind(...binds),
    db
      .prepare(
        `select activity_id, status, count(*) as n from rsvps where activity_id in (${marks}) group by activity_id, status`,
      )
      .bind(...binds),
    db
      .prepare(
        `select activity_id, count(*) as n from messages where activity_id in (${marks}) and deleted_at is null
         group by activity_id`,
      )
      .bind(...binds),
    db
      .prepare(
        `select activity_id, body, created_at from messages m where activity_id in (${marks}) and kind = 'update'
         and created_at = (select max(created_at) from messages where activity_id = m.activity_id and kind = 'update')`,
      )
      .bind(...binds),
  ]);
  const by = <T>(rows: Record<string, unknown>[] | undefined, id: string) =>
    (rows ?? []).filter((x) => x.activity_id === id) as T[];
  return rows.map((r) => {
    const counts = by<{ status: string; n: number }>(rsvps?.results, r.id);
    const upd = by<{ body: string; created_at: string }>(updates?.results, r.id)[0];
    return {
      id: r.id,
      sport: r.sport,
      icon: r.icon,
      title: r.title,
      date: r.date,
      startTime: r.start_time,
      endTime: r.end_time,
      spotId: r.spot_id,
      outdoor: Boolean(r.outdoor),
      pace: r.pace_mph,
      details: r.details,
      notes: r.notes,
      status: r.status,
      updatedAt: r.updated_at,
      routes: by<{ label: string; rwgps_route_id: number; stop_poi: string | null; name: string | null }>(
        routes?.results,
        r.id,
      ).map((x) => ({ label: x.label, routeId: x.rwgps_route_id, stop: x.stop_poi, name: x.name })),
      counts: {
        in: counts.find((x) => x.status === "in")?.n ?? 0,
        out: counts.find((x) => x.status === "out")?.n ?? 0,
        messages: by<{ n: number }>(msgs?.results, r.id)[0]?.n ?? 0,
      },
      lastUpdate: upd ? { at: upd.created_at, text: upd.body } : null,
      observed: r.observed_json ? (JSON.parse(r.observed_json) as RecordedWeather) : null,
    };
  });
}

interface MessageRow {
  id: string;
  parent_id: string | null;
  kind: Message["kind"];
  user_id: string | null;
  name: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

const NOT_FOUND = "Activity not found";

async function detail(db: D1Database, id: string): Promise<ActivityDetail> {
  const [act] = await summaries(db, "a.id = ?", [id]);
  if (!act) return fail(404, NOT_FOUND);
  const [rsvps, messages, made, changes] = await Promise.all([
    db
      .prepare(
        `select v.user_id, u.name, v.status, v.route_label from rsvps v join "user" u on u.id = v.user_id where v.activity_id = ? order by v.updated_at`,
      )
      .bind(id)
      .all<{ user_id: string; name: string; status: "in" | "out"; route_label: string | null }>(),
    db
      .prepare(
        `select m.id, m.parent_id, m.kind, m.user_id, u.name, m.body, m.created_at, m.edited_at, m.deleted_at
         from messages m left join "user" u on u.id = m.user_id where m.activity_id = ? order by m.created_at`,
      )
      .bind(id)
      .all<MessageRow>(),
    db
      .prepare(`select a.created_at, u.name from activities a left join "user" u on u.id = a.created_by where a.id = ?`)
      .bind(id)
      .first<{ created_at: string; name: string | null }>(),
    db
      .prepare(
        `select l.action, l.at, u.name from audit_log l left join "user" u on u.id = l.user_id
         where l.entity = 'activity' and l.entity_id = ? and l.action in ('update', 'cancel', 'restore') order by l.at`,
      )
      .bind(id)
      .all<{ action: "update" | "cancel" | "restore"; at: string; name: string | null }>(),
  ]);
  return {
    ...act,
    history: history(made, changes.results, messages.results),
    rsvps: rsvps.results.map(
      (v): Rsvp => ({ userId: v.user_id, name: v.name, status: v.status, routeLabel: v.route_label }),
    ),
    messages: messages.results.map(
      (m): Message => ({
        id: m.id,
        parentId: m.parent_id,
        kind: m.kind,
        authorId: m.user_id,
        authorName: m.name,
        body: m.deleted_at ? "" : m.body,
        createdAt: m.created_at,
        editedAt: m.edited_at,
        deleted: Boolean(m.deleted_at),
      }),
    ),
  };
}

const HISTORY_MAX = 50;
const ACTION = { update: "changed", cancel: "cancelled", restore: "restored" } as const;
const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) < 5000;

/** Who created the activity and every later change (audit log), newest first. An update's note (the system message
 * written in the same batch) says what changed; a cancellation by Replace has no audit row of its own, only its note. */
function history(
  made: { created_at: string; name: string | null } | null,
  changes: { action: "update" | "cancel" | "restore"; at: string; name: string | null }[],
  messages: MessageRow[],
): HistoryEntry[] {
  const notes = messages.filter((m) => m.kind !== "user");
  const out: HistoryEntry[] = changes.map((c) => ({
    at: c.at,
    who: c.name,
    action: ACTION[c.action],
    text:
      c.action === "update" ? (notes.find((m) => m.kind === "update" && near(m.created_at, c.at))?.body ?? null) : null,
  }));
  for (const m of notes)
    if (m.kind === "cancel" && !changes.some((c) => c.action === "cancel" && near(c.at, m.created_at)))
      out.push({ at: m.created_at, who: null, action: "replaced", text: null });
  if (made) out.push({ at: made.created_at, who: made.name, action: "created", text: null });
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, HISTORY_MAX);
}

/** The activity Plan's "Replace" names: published, the same sport and day as the new plan, and not the one being edited.
 * Several activities of a sport may share a day; Replace is the editor's choice, never automatic. */
async function replaceTarget(db: D1Database, id: string | null, date: string, sport: Sport, except = "") {
  if (!id) return null;
  const t = await db
    .prepare("select id from activities where id = ? and date = ? and sport = ? and status = 'published' and id != ?")
    .bind(id, date, sport, except)
    .first<{ id: string }>();
  return t ?? fail(409, "The activity to replace isn't posted for that day any more");
}

/** What people need to know when a published activity changes (DESIGN.md → Editing a published ride). */
async function changes(db: D1Database, a: Activity, b: ActivityValues): Promise<string[]> {
  const names = async (ids: number[]) => {
    const { results } = await db
      .prepare(
        `select rwgps_route_id as id, name from route_cache where rwgps_route_id in (${ids.map(() => "?").join(",")})`,
      )
      .bind(...ids)
      .all<{ id: number; name: string | null }>();
    return new Map(results.map((r) => [r.id, r.name ?? `#${r.id}`]));
  };
  const n = await names([...new Set([...a.routes, ...b.routes].map((r) => r.routeId))]);
  const routeText = (rs: RideRoute[]) =>
    rs.map((r) => `${r.label === "Main" ? "" : `${r.label} `}${n.get(r.routeId)}`).join(" / ");
  const spot = async (id: string) =>
    (await db.prepare("select name from spots where id = ?").bind(id).first<{ name: string }>())?.name ?? id;
  const time = (t: string) => fmtTime(hhmmToMin(t));
  const out: string[] = [];
  if (a.title !== b.title) out.push(b.title ? `now "${b.title}"` : "title removed");
  if (a.date !== b.date) out.push(`moved to ${dayLabel(b.date, true)}`);
  if (a.startTime !== b.startTime)
    out.push(`${hasRoute(b.sport) ? "meet" : "starts"} ${time(a.startTime)} → ${time(b.startTime)}`);
  if (a.endTime && b.endTime && a.endTime !== b.endTime) out.push(`ends ${time(a.endTime)} → ${time(b.endTime)}`);
  if (a.spotId !== b.spotId)
    out.push(`${hasRoute(b.sport) ? "start" : "at"} ${await spot(a.spotId)} → ${await spot(b.spotId)}`);
  if (a.outdoor !== b.outdoor) out.push(b.outdoor ? "now outdoors" : "now indoors");
  if (hasRoute(b.sport) && Math.abs(a.pace - b.pace) > 0.01)
    out.push(b.sport === "run" ? `pace ${minPerMile(b.pace)} min/mi` : `pace ${b.pace} mph`);
  if (a.details !== b.details) out.push(b.details ? `details: ${b.details}` : "details removed");
  if (routeText(a.routes) !== routeText(b.routes)) out.push(`route ${routeText(b.routes)}`);
  const aStop = a.routes[0]?.stop ?? null;
  const bStop = b.routes[0]?.stop ?? null;
  if (aStop !== bStop) out.push(bStop ? `coffee stop ${bStop}` : "no coffee stop");
  else if ((a.routes[1]?.stop ?? null) !== (b.routes[1]?.stop ?? null))
    out.push(`${b.routes[1]?.label ?? "alternate"} coffee stop updated`);
  if (a.notes !== b.notes) out.push("notes updated");
  return out;
}

const routeRows = (db: D1Database, id: string, routes: ActivityValues["routes"]) => [
  db.prepare("delete from activity_routes where activity_id = ?").bind(id),
  ...routes.map((r, i) =>
    db
      .prepare(
        "insert into activity_routes (activity_id, sort, label, rwgps_route_id, stop_poi) values (?, ?, ?, ?, ?)",
      )
      .bind(id, i, r.label, r.routeId, r.stop),
  ),
  // A route choice on an RSVP only makes sense while that labelled alternate exists.
  routes.length > 1
    ? db
        .prepare(
          `update rsvps set route_label = null where activity_id = ? and route_label not in (${routes.map(() => "?").join(",")})`,
        )
        .bind(id, ...routes.map((r) => r.label))
    : db.prepare("update rsvps set route_label = null where activity_id = ?").bind(id),
];
const systemMessage = (db: D1Database, id: string, kind: Message["kind"], body: string) =>
  db
    .prepare("insert into messages (id, activity_id, kind, body, created_at) values (?, ?, ?, ?, ?)")
    .bind(newId(), id, kind, body, nowIso());

/** The date must be today or later, and the spot active (an archived spot may stay on an activity that already uses it). */
async function checkInput(db: D1Database, input: ActivityValues, currentSpot?: string) {
  if (input.date < nyNow().date) fail(400, "Pick today or a later date");
  const spot = await db
    .prepare("select archived from spots where id = ?")
    .bind(input.spotId)
    .first<{ archived: number }>();
  if (!spot || (spot.archived && input.spotId !== currentSpot)) fail(400, "Unknown place");
}

const REPLACED_NOTE = "Cancelled: replaced by a new plan.";
/** Replace cancels the activity the editor picked (same sport and day); it keeps its RSVPs and messages. */
const cancelReplaced = (db: D1Database, id: string, userId: string, now: string) => [
  db
    .prepare("update activities set status = 'cancelled', updated_by = ?, updated_at = ? where id = ?")
    .bind(userId, now, id),
  systemMessage(db, id, "cancel", REPLACED_NOTE),
];
const STALE = "Someone changed this after you opened it. Discard your changes and edit it again.";
const PAST = "Past activities can't be changed";
const subject = (a: Activity, what: string) => `${what}: ${activityName(a)}, ${dayLabel(a.date)}`;

/** "New ride: Katonah loop" · "Sat, Oct 17 · 8:30 AM · SUNY Purchase", to people following that sport. */
async function announce(env: Env, a: Activity, author: string) {
  const spot = await env.DB.prepare("select name from spots where id = ?").bind(a.spotId).first<{ name: string }>();
  const when = `${dayLabel(a.date)} · ${fmtTime(hhmmToMin(a.startTime))}${spot ? ` · ${spot.name}` : ""}`;
  await notifyActivity(env, a.id, `New ${SPORT_LABEL[a.sport].toLowerCase()}: ${activityName(a)}`, when, {
    newPost: { sport: a.sport, author },
  });
}

async function notifyReplaced(env: Env, id: string) {
  const [old] = await summaries(env.DB, "a.id = ?", [id]);
  if (old) await notifyActivity(env, id, subject(old, "Cancelled"), "Replaced by a new plan.");
}

/** Tells the people a message newly mentions (not its author), even if they muted the sport or aren't going. */
async function notifyMentions(env: Env, activityId: string, authorId: string, body: string, before = "") {
  const already = new Set(mentionIds(before));
  const ids = mentionIds(body).filter((id) => id !== authorId && !already.has(id));
  if (!ids.length) return;
  const all = [...new Set([...mentionIds(body), authorId])];
  const [{ results }, [act]] = await Promise.all([
    env.DB.prepare(`select id, name from "user" where id in (select value from json_each(?))`)
      .bind(JSON.stringify(all))
      .all<{ id: string; name: string }>(),
    summaries(env.DB, "a.id = ?", [activityId]),
  ]);
  if (!act) return;
  const names = new Map(results.map((r) => [r.id, r.name]));
  const who = (names.get(authorId) ?? "Someone").split(" ")[0];
  const text = plainMentions(body, (id) => names.get(id));
  await notifyActivity(env, activityId, `${who} mentioned you · ${activityName(act)}`, text.slice(0, 300), {
    to: ids.filter((id) => names.has(id)),
  });
}

export const activities = new Hono<AppEnv>()
  // Upcoming activities (today on), published and cancelled, each with the viewer's own answer.
  .get("/", async (c) => {
    const today = nyNow().date;
    // An activity cancelled by Replace drops off the list: its replacement is there.
    const [acts, mine] = await Promise.all([
      summaries(
        c.env.DB,
        `a.date >= ? and not (a.status = 'cancelled' and exists (select 1 from messages r where r.activity_id = a.id
           and r.kind = 'cancel' and r.body = '${REPLACED_NOTE}'))`,
        [today],
      ),
      c.env.DB.prepare(
        "select v.activity_id, v.status from rsvps v join activities a on a.id = v.activity_id where v.user_id = ? and a.date >= ?",
      )
        .bind(c.get("user").id, today)
        .all<{ activity_id: string; status: "in" | "out" }>(),
    ]);
    const answer = new Map(mine.results.map((r) => [r.activity_id, r.status]));
    const marks = await markers(c.env.DB, c.get("user").id, today);
    return c.json(acts.map((a) => ({ ...a, mine: answer.get(a.id) ?? null, unseen: marks.get(a.id) ?? null })));
  })
  .get("/past", async (c) =>
    c.json(await summaries(c.env.DB, "a.date < ?", [nyNow().date], "a.date desc, a.start_time desc", 200)),
  )
  // Opening an activity records the visit; the reply says when the viewer last caught up, for the "N new" divider.
  .get("/:id", async (c) => {
    const act = await detail(c.env.DB, c.req.param("id"));
    return c.json({ ...act, seenBefore: await visit(c.env.DB, c.get("user").id, act.id) });
  })

  .post("/", requireRole("edit"), validate("json", activityInput), async (c) => {
    const input = c.req.valid("json");
    await checkInput(c.env.DB, input);
    if (input.sport !== "other" && !(await loadSettings(c.env.DB)).sports.includes(input.sport))
      fail(400, "That sport is turned off in Settings");
    const user = c.get("user");
    const clash = await replaceTarget(c.env.DB, input.replaceId, input.date, input.sport);
    const id = newId();
    const now = nowIso();
    await c.env.DB.batch([
      ...(clash ? cancelReplaced(c.env.DB, clash.id, user.id, now) : []),
      c.env.DB.prepare(
        `insert into activities (id, sport, icon, title, date, start_time, end_time, spot_id, outdoor, pace_mph, details, notes,
                                 status, created_by, updated_by, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)`,
      ).bind(
        id,
        input.sport,
        input.icon,
        input.title,
        input.date,
        input.startTime,
        input.endTime,
        input.spotId,
        Number(input.outdoor),
        input.pace,
        input.details,
        input.notes,
        user.id,
        user.id,
        now,
        now,
      ),
      ...routeRows(c.env.DB, id, input.routes),
      c.env.DB.prepare("delete from drafts where user_id = ?").bind(user.id),
      audit(c.env.DB, user.id, "publish", "activity", id, input),
    ]);
    if (clash) c.executionCtx.waitUntil(notifyReplaced(c.env, clash.id));
    const created = await detail(c.env.DB, id);
    c.executionCtx.waitUntil(announce(c.env, created, user.id));
    return c.json(created, 201);
  })

  .put("/:id", requireRole("edit"), validate("json", activityUpdate), async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const [cur] = await summaries(c.env.DB, "a.id = ?", [id]);
    if (!cur) return fail(404, NOT_FOUND);
    if (cur.date < nyNow().date) fail(409, PAST);
    if (input.sport !== cur.sport) fail(400, "The sport can't change; post a new activity instead");
    if (input.baseUpdatedAt !== cur.updatedAt) fail(409, STALE);
    await checkInput(c.env.DB, input, cur.spotId);
    const user = c.get("user");
    const clash =
      cur.status === "published" ? await replaceTarget(c.env.DB, input.replaceId, input.date, input.sport, id) : null;
    // Only a published activity announces changes; editing a cancelled one stays quiet until it's restored.
    const what = cur.status === "published" ? await changes(c.env.DB, cur, input) : [];
    const now = nowIso();
    await c.env.DB.batch([
      // Re-checked inside the transaction: json('stale') fails, rolling back the batch, if it changed meanwhile.
      c.env.DB.prepare(
        "select case when (select updated_at from activities where id = ?) = ? then 1 else json('stale') end",
      ).bind(id, cur.updatedAt),
      ...(clash ? cancelReplaced(c.env.DB, clash.id, user.id, now) : []),
      c.env.DB.prepare(
        `update activities set icon = ?, title = ?, date = ?, start_time = ?, end_time = ?, spot_id = ?, outdoor = ?, pace_mph = ?,
                               details = ?, notes = ?, updated_by = ?, updated_at = ? where id = ?`,
      ).bind(
        input.icon,
        input.title,
        input.date,
        input.startTime,
        input.endTime,
        input.spotId,
        Number(input.outdoor),
        input.pace,
        input.details,
        input.notes,
        user.id,
        now,
        id,
      ),
      ...routeRows(c.env.DB, id, input.routes),
      ...(what.length ? [systemMessage(c.env.DB, id, "update", what.join(" · "))] : []),
      c.env.DB.prepare("delete from drafts where user_id = ?").bind(user.id),
      audit(c.env.DB, user.id, "update", "activity", id, input),
    ]).catch((e) => {
      if (/malformed JSON/i.test(String(e))) fail(409, STALE);
      throw e;
    });
    if (clash) c.executionCtx.waitUntil(notifyReplaced(c.env, clash.id));
    if (what.length) {
      const updated = await detail(c.env.DB, id);
      c.executionCtx.waitUntil(
        notifyActivity(c.env, id, subject(updated, "Updated"), what.join(" · "), { answer: true }),
      );
      return c.json(updated);
    }
    return c.json(await detail(c.env.DB, id));
  })

  .post("/:id/cancel", requireRole("edit"), async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const [cur] = await summaries(c.env.DB, "a.id = ?", [id]);
    if (!cur) return fail(404, NOT_FOUND);
    if (cur.date < nyNow().date) fail(409, PAST);
    if (cur.status === "cancelled") return c.json(await detail(c.env.DB, id));
    await c.env.DB.batch([
      c.env.DB.prepare("update activities set status = 'cancelled', updated_by = ?, updated_at = ? where id = ?").bind(
        user.id,
        nowIso(),
        id,
      ),
      systemMessage(c.env.DB, id, "cancel", "Cancelled."),
      audit(c.env.DB, user.id, "cancel", "activity", id),
    ]);
    c.executionCtx.waitUntil(notifyActivity(c.env, id, subject(cur, "Cancelled"), "Check Who's in for messages."));
    return c.json(await detail(c.env.DB, id));
  })

  .post("/:id/restore", requireRole("edit"), async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const [cur] = await summaries(c.env.DB, "a.id = ?", [id]);
    if (!cur) return fail(404, NOT_FOUND);
    if (cur.date < nyNow().date) fail(409, PAST);
    if (cur.status === "published") return c.json(await detail(c.env.DB, id));
    await c.env.DB.batch([
      c.env.DB.prepare("update activities set status = 'published', updated_by = ?, updated_at = ? where id = ?").bind(
        user.id,
        nowIso(),
        id,
      ),
      systemMessage(c.env.DB, id, "restore", "Back on."),
      audit(c.env.DB, user.id, "restore", "activity", id),
    ]);
    c.executionCtx.waitUntil(notifyActivity(c.env, id, subject(cur, "Back on"), "Happening as planned."));
    return c.json(await detail(c.env.DB, id));
  })

  // Admins only: removes the activity with its routes, RSVPs and messages for good. People going to an upcoming one
  // are told; the audit log keeps what it was.
  .delete("/:id", requireRole("admin"), async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const [cur] = await summaries(c.env.DB, "a.id = ?", [id]);
    if (!cur) return fail(404, NOT_FOUND);
    const { results: going } = await c.env.DB.prepare(
      "select user_id from rsvps where activity_id = ? and status = 'in' and user_id != ?",
    )
      .bind(id, user.id)
      .all<{ user_id: string }>();
    const db = c.env.DB;
    await db.batch([
      db.prepare("delete from activity_seen where activity_id = ?").bind(id),
      db.prepare("delete from messages where activity_id = ? and parent_id is not null").bind(id),
      db.prepare("delete from messages where activity_id = ?").bind(id),
      db.prepare("delete from rsvps where activity_id = ?").bind(id),
      db.prepare("delete from activity_routes where activity_id = ?").bind(id),
      db.prepare("delete from activities where id = ?").bind(id),
      // Anyone's autosaved Plan form that was editing it would only fail to update
      db.prepare("delete from drafts where json_extract(form_json, '$.editing') = ?").bind(id),
      audit(db, user.id, "delete", "activity", id, {
        sport: cur.sport,
        title: activityName(cur),
        date: cur.date,
        startTime: cur.startTime,
      }),
    ]);
    if (cur.status === "published" && cur.date >= nyNow().date)
      c.executionCtx.waitUntil(
        notifyActivity(c.env, id, subject(cur, "Deleted"), "Removed by a team admin.", {
          to: going.map((g) => g.user_id),
          url: "/",
        }),
      );
    return c.body(null, 204);
  })

  // RSVP: In / Out (route label only for In with an alternate route), or null to clear.
  .put("/:id/rsvp", validate("json", rsvpInput), async (c) => {
    const id = c.req.param("id");
    const { status, routeLabel } = c.req.valid("json");
    const [act] = await summaries(c.env.DB, "a.id = ?", [id]);
    if (!act) return fail(404, NOT_FOUND);
    if (act.status !== "published" || act.date < nyNow().date) fail(409, "RSVP is closed");
    const user = c.get("user");
    if (!status) {
      await c.env.DB.prepare("delete from rsvps where activity_id = ? and user_id = ?").bind(id, user.id).run();
    } else {
      const label =
        status === "in" && act.routes.length > 1 && act.routes.some((r) => r.label === routeLabel) ? routeLabel : null;
      await c.env.DB.prepare(
        `insert into rsvps (activity_id, user_id, status, route_label, updated_at) values (?, ?, ?, ?, ?)
         on conflict (activity_id, user_id) do update set status = excluded.status, route_label = excluded.route_label,
         updated_at = excluded.updated_at`,
      )
        .bind(id, user.id, status, label, nowIso())
        .run();
    }
    return c.json(await detail(c.env.DB, id));
  })

  // Messages: anyone can post or reply (one level) on upcoming published activities.
  .post("/:id/messages", validate("json", messageInput), async (c) => {
    const id = c.req.param("id");
    const { body, parentId } = c.req.valid("json");
    const act = await c.env.DB.prepare("select date, status from activities where id = ?")
      .bind(id)
      .first<{ date: string; status: string }>();
    if (!act) return fail(404, NOT_FOUND);
    if (act.date < nyNow().date) fail(409, "Posting is closed on past activities");
    if (act.status !== "published") fail(409, "Posting is closed on cancelled activities");
    if (parentId) {
      const parent = await c.env.DB.prepare("select parent_id from messages where id = ? and activity_id = ?")
        .bind(parentId, id)
        .first<{ parent_id: string | null }>();
      if (!parent || parent.parent_id) fail(400, "Replies go to a top-level message");
    }
    const user = c.get("user");
    await c.env.DB.prepare(
      "insert into messages (id, activity_id, user_id, parent_id, body, created_at) values (?, ?, ?, ?, ?, ?)",
    )
      .bind(newId(), id, user.id, parentId, body, nowIso())
      .run();
    c.executionCtx.waitUntil(notifyMentions(c.env, id, user.id, body));
    return c.json(await detail(c.env.DB, id), 201);
  });

// Editing and deleting a message: authors edit their own; authors, editors and admins delete (soft delete).
export const messages = new Hono<AppEnv>()
  .patch("/:id", validate("json", messageEdit), async (c) => {
    const m = await c.env.DB.prepare(
      `select m.activity_id, m.user_id, m.body, m.deleted_at, a.date, a.status from messages m
       join activities a on a.id = m.activity_id where m.id = ?`,
    )
      .bind(c.req.param("id"))
      .first<{
        activity_id: string;
        user_id: string | null;
        body: string;
        deleted_at: string | null;
        date: string;
        status: string;
      }>();
    if (!m || m.deleted_at) return fail(404, "Message not found");
    if (m.user_id !== c.get("user").id) fail(403, "Only the author can edit a message");
    if (m.date < nyNow().date) fail(409, "Messages on past activities can't be edited");
    if (m.status !== "published") fail(409, "Messages on cancelled activities can't be edited"); // as for posting
    const { body } = c.req.valid("json");
    await c.env.DB.prepare("update messages set body = ?, edited_at = ? where id = ?")
      .bind(body, nowIso(), c.req.param("id"))
      .run();
    c.executionCtx.waitUntil(notifyMentions(c.env, m.activity_id, c.get("user").id, body, m.body)); // only newly mentioned
    return c.json(await detail(c.env.DB, m.activity_id));
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const m = await c.env.DB.prepare(
      `select m.activity_id, m.user_id, m.kind, m.deleted_at, a.date from messages m
       join activities a on a.id = m.activity_id where m.id = ?`,
    )
      .bind(c.req.param("id"))
      .first<{ activity_id: string; user_id: string | null; kind: string; deleted_at: string | null; date: string }>();
    if (m?.kind !== "user") return fail(404, "Message not found");
    if (m.deleted_at) return c.json(await detail(c.env.DB, m.activity_id)); // already deleted: nothing to do
    // Authors delete their own on upcoming activities; editors and admins can always delete (moderation).
    if (!can(user, "edit") && (m.user_id !== user.id || m.date < nyNow().date))
      fail(403, "You can't delete this message");
    await c.env.DB.batch([
      c.env.DB.prepare("update messages set body = '', deleted_at = ? where id = ?").bind(nowIso(), c.req.param("id")),
      ...(m.user_id !== user.id ? [audit(c.env.DB, user.id, "delete", "message", c.req.param("id"))] : []),
    ]);
    return c.json(await detail(c.env.DB, m.activity_id));
  });
