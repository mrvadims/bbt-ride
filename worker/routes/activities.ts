// Activities (rides, runs, swims…), RSVPs and messages (DESIGN.md → Rides, Plan a ride, v2).
import { Hono } from "hono";
import {
  type Activity,
  type ActivityDetail,
  type ActivityValues,
  activityInput,
  activityName,
  activityUpdate,
  GUESTS_MAX,
  type HistoryEntry,
  type Message,
  messageInput,
  type RecordedWeather,
  type Rsvp,
  rsvpInput,
} from "../../shared/api.ts";
import { firstName, mentionIds, plainMentions } from "../../shared/people.ts";
import type { RideRoute } from "../../shared/ride.ts";
import type { Icon } from "../../shared/sport-icons.ts";
import { minPerMile, SPORT_LABEL, type Sport, timedByRoute } from "../../shared/sports.ts";
import { dayLabel, fmtTime, hhmmToMin, nyNow } from "../../shared/time.ts";
import { type AppEnv, can, requireRole, type SessionUser } from "../app.ts";
import { notifyActivity } from "../push.ts";
import { markers, visit } from "../seen.ts";
import {
  checkParent,
  deleteThread,
  MESSAGES_OF,
  type MessageRow,
  messageOf,
  postMessage,
  threadMessages,
} from "../threads.ts";
import { audit, fail, newId, nowIso, pollVisible, sameBatch, visible } from "../util.ts";
import { validate } from "../validate.ts";
import { linkPoll, planFromPoll, pollPlanned } from "./polls.ts";
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
  private: number;
  created_by: string | null;
  online: number;
}

const VISIBLE = visible();
// The same answer whether the activity doesn't exist or is private and the viewer isn't invited.
const NOT_FOUND = "Activity not found";
/** First in a batch that changes an activity: fails it (nothing is written) unless the viewer can still see it, so a
 * guest removed a moment ago can't answer, post or cancel after all. */
const stillVisible = (db: D1Database, id: string, viewer: string) =>
  db
    .prepare(
      `select case when exists (select 1 from activities a where a.id = ? and ${VISIBLE}) then 1 else json('gone') end`,
    )
    .bind(id, viewer);
const gone = (e: unknown): never => {
  if (/malformed JSON/i.test(String(e))) fail(404, NOT_FOUND);
  throw e;
};

/** Summaries of the activities matching `where` (a condition on table alias a) that `viewer` may see, with routes, counts
 * and the latest update. Only background work about an activity it already holds (notifications) passes viewer null. */
export async function summaries(
  db: D1Database,
  viewer: string | null,
  where: string,
  whereBinds: unknown[],
  order = "a.date, a.start_time, a.created_at",
  limit?: number,
): Promise<Activity[]> {
  const binds = viewer === null ? whereBinds : [...whereBinds, viewer];
  const cond = viewer === null ? where : `(${where}) and ${VISIBLE}`;
  // a.id last: the limited list must come out the same in the subqueries below, even when dates and times tie.
  const pick = `from activities a where ${cond} order by ${order}, a.id${limit ? ` limit ${limit}` : ""}`;
  const { results: rows } = await db
    .prepare(
      `select a.id, a.sport, a.icon, a.title, a.date, a.start_time, a.end_time, a.spot_id, a.outdoor, a.pace_mph, a.details,
              a.notes, a.status, a.updated_at, a.observed_json, a.private, a.created_by,
              (select s.online from spots s where s.id = a.spot_id) as online ${pick}`,
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
        `select t.activity_id, count(*) as n from ${MESSAGES_OF} where t.activity_id in (${marks}) and m.deleted_at is null
         group by t.activity_id`,
      )
      .bind(...binds),
    db
      .prepare(
        `select t.activity_id, m.body, m.created_at from ${MESSAGES_OF} where t.activity_id in (${marks}) and m.kind = 'update'
         and m.created_at = (select max(created_at) from messages where thread_id = m.thread_id and kind = 'update')`,
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
      private: Boolean(r.private),
      createdBy: r.created_by,
      online: Boolean(r.online),
    };
  });
}

/** The activity, if the viewer may see it; else 404. */
async function load(db: D1Database, viewer: string, id: string): Promise<Activity> {
  const [act] = await summaries(db, viewer, "a.id = ?", [id]);
  return act ?? fail(404, NOT_FOUND);
}

export async function detail(db: D1Database, viewer: string, id: string): Promise<ActivityDetail> {
  const act = await load(db, viewer, id);
  const [guests, rsvps, messages, made, changes, poll] = await Promise.all([
    db
      .prepare(
        `select g.user_id, u.name from activity_guests g join "user" u on u.id = g.user_id where g.activity_id = ?
         order by g.user_id = ? desc, u.name`,
      )
      .bind(id, act.createdBy)
      .all<{ user_id: string; name: string }>(),
    db
      .prepare(
        `select v.user_id, u.name, v.status, v.route_label from rsvps v join "user" u on u.id = v.user_id where v.activity_id = ? order by v.updated_at`,
      )
      .bind(id)
      .all<{ user_id: string; name: string; status: "in" | "out"; route_label: string | null }>(),
    threadMessages(db, { kind: "activity", id }).all<MessageRow>(),
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
    // The date poll it was planned from, if the viewer may see that poll
    db
      .prepare(
        `select p.id, p.title, (select count(*) from messages m join threads t on t.id = m.thread_id
           where t.poll_id = p.id and m.kind = 'user' and m.deleted_at is null) as messages
         from date_polls p where p.activity_id = ?1 and ${pollVisible("?2")} order by p.created_at desc limit 1`,
      )
      .bind(id, viewer)
      .first<{ id: string; title: string; messages: number }>(),
  ]);
  return {
    ...act,
    guests: guests.results.map((g) => ({ userId: g.user_id, name: g.name })),
    history: history(made, changes.results, messages.results),
    rsvps: rsvps.results.map(
      (v): Rsvp => ({ userId: v.user_id, name: v.name, status: v.status, routeLabel: v.route_label }),
    ),
    messages: messages.results.map(messageOf),
    fromPoll: poll ? { id: poll.id, title: poll.title, messages: poll.messages } : null,
  };
}

const HISTORY_MAX = 50;
const ACTION = { update: "changed", cancel: "cancelled", restore: "restored" } as const;

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
      c.action === "update"
        ? (notes.find((m) => m.kind === "update" && sameBatch(m.created_at, c.at))?.body ?? null)
        : null,
  }));
  for (const m of notes)
    if (m.kind === "cancel" && !changes.some((c) => c.action === "cancel" && sameBatch(c.at, m.created_at)))
      out.push({ at: m.created_at, who: null, action: "replaced", text: null });
  if (made) out.push({ at: made.created_at, who: made.name, action: "created", text: null });
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, HISTORY_MAX);
}

/** The activity Plan's "Replace" names: published, the same sport and day as the new plan, and not the one being edited.
 * Several activities of a sport may share a day; Replace is the editor's choice, never automatic. */
async function replaceTarget(
  db: D1Database,
  viewer: string,
  id: string | null,
  date: string,
  sport: Sport,
  fromPrivate: boolean,
  except = "",
) {
  if (!id) return null;
  const t = await db
    .prepare(
      `select a.id, a.private from activities a where a.id = ? and a.date = ? and a.sport = ? and a.status = 'published'
       and a.id != ? and ${VISIBLE}`,
    )
    .bind(id, date, sport, except, viewer)
    .first<{ id: string; private: number }>();
  if (!t) return fail(409, "The activity to replace isn't posted for that day any more");
  // Its replacement would be hidden from most of the team, so the public one would just vanish from their Home.
  if (fromPrivate && !t.private) fail(400, "A private plan can't replace a public one; cancel it instead");
  return t;
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
    out.push(`${timedByRoute(b.sport, b.online) ? "meet" : "starts"} ${time(a.startTime)} → ${time(b.startTime)}`);
  if (a.endTime && b.endTime && a.endTime !== b.endTime) out.push(`ends ${time(a.endTime)} → ${time(b.endTime)}`);
  if (a.spotId !== b.spotId)
    out.push(`${timedByRoute(b.sport, b.online) ? "start" : "at"} ${await spot(a.spotId)} → ${await spot(b.spotId)}`);
  if (a.outdoor !== b.outdoor) out.push(b.outdoor ? "now outdoors" : "now indoors");
  if (timedByRoute(b.sport, b.online) && Math.abs(a.pace - b.pace) > 0.01)
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
  postMessage(db, { kind: "activity", id }, { kind, body });

/** The date must be today or later, and the spot active (an archived spot may stay on an activity that already uses it);
 * whether it's online must be what the app planned for (times and route rules depend on it). */
async function checkInput(db: D1Database, input: ActivityValues, currentSpot?: string) {
  if (input.date < nyNow().date) fail(400, "Pick today or a later date");
  const spot = await db
    .prepare("select archived, online from spots where id = ?")
    .bind(input.spotId)
    .first<{ archived: number; online: number }>();
  if (!spot || (spot.archived && input.spotId !== currentSpot)) fail(400, "Unknown place");
  if (Boolean(spot?.online) !== input.online) fail(400, "That place changed; pick it again");
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

/** "New ride: Katonah loop" · "Sat, Oct 17 · 8:30 AM · SUNY Purchase", to people following that sport (except
 * `except`, who already know it). A private one goes to the people `invited` instead, whatever sports they muted:
 * "Dana invited you: Katonah loop". */
async function announce(
  env: Env,
  a: Activity,
  author: SessionUser,
  to: { invited: string[] } | { except: string[] } = { except: [] },
) {
  const spot = await env.DB.prepare("select name from spots where id = ?").bind(a.spotId).first<{ name: string }>();
  const when = `${dayLabel(a.date)} · ${fmtTime(hhmmToMin(a.startTime))}${spot ? ` · ${spot.name}` : ""}`;
  if ("invited" in to)
    await notifyActivity(env, a.id, `${firstName(author.name)} invited you: ${activityName(a)}`, when, {
      to: to.invited.filter((id) => id !== author.id),
    });
  else
    await notifyActivity(env, a.id, `New ${SPORT_LABEL[a.sport].toLowerCase()}: ${activityName(a)}`, when, {
      newPost: { sport: a.sport, author: author.id },
      except: to.except,
    });
}

/** A private activity's guest list as it will be stored: the creator and the person posting or editing (who would
 * otherwise lose it mid-edit), plus the people picked. Whoever is added must be an active member; people already
 * invited stay even if they were disabled since. */
async function guestList(
  db: D1Database,
  picked: string[],
  creator: string | null,
  editor: string,
  current: string[] = [],
) {
  const ids = [...new Set([...(creator ? [creator] : []), editor, ...picked])];
  if (ids.length > GUESTS_MAX) fail(400, `Invite at most ${GUESTS_MAX} people`);
  if (!ids.some((id) => id !== creator)) fail(400, "Invite at least one person");
  const added = ids.filter((id) => !current.includes(id));
  const { results } = await db
    .prepare(`select id from "user" where coalesce(banned, 0) = 0 and id in (select value from json_each(?))`)
    .bind(JSON.stringify(added))
    .all<{ id: string }>();
  if (results.length !== added.length) fail(400, "Someone on the guest list isn't on the team");
  return { ids, added };
}
/** Stores the guest list as given, then drops answers and visits of anyone not on it (their messages stay). */
const guestRows = (db: D1Database, id: string, ids: string[]) => [
  db
    .prepare("insert or ignore into activity_guests (activity_id, user_id) select ?, value from json_each(?)")
    .bind(id, JSON.stringify(ids)),
  db
    .prepare("delete from activity_guests where activity_id = ? and user_id not in (select value from json_each(?))")
    .bind(id, JSON.stringify(ids)),
  ...["rsvps", "activity_seen"].map((t) =>
    db
      .prepare(
        `delete from ${t} where activity_id = ?1 and user_id not in (select user_id from activity_guests where activity_id = ?1)`,
      )
      .bind(id),
  ),
];

async function notifyReplaced(env: Env, id: string) {
  const [old] = await summaries(env.DB, null, "a.id = ?", [id]);
  if (old) await notifyActivity(env, id, subject(old, "Cancelled"), "Replaced by a new plan.");
}

/** Tells the people a new message mentions (not its author), even if they muted the sport or aren't going. Editing a
 * message never notifies, so a mention can't be sent again and again. */
async function notifyMentions(env: Env, activityId: string, authorId: string, body: string) {
  const ids = mentionIds(body).filter((id) => id !== authorId);
  if (!ids.length) return;
  const all = [...ids, authorId];
  const [{ results }, [act]] = await Promise.all([
    env.DB.prepare(`select id, name from "user" where id in (select value from json_each(?))`)
      .bind(JSON.stringify(all))
      .all<{ id: string; name: string }>(),
    summaries(env.DB, null, "a.id = ?", [activityId]),
  ]);
  if (!act) return;
  const names = new Map(results.map((r) => [r.id, r.name]));
  const who = firstName(names.get(authorId));
  const text = plainMentions(body, (id) => names.get(id));
  await notifyActivity(env, activityId, `${who} mentioned you · ${activityName(act)}`, text.slice(0, 300), {
    to: ids.filter((id) => names.has(id)),
  });
}

/** Who may delete an activity they can see: Admins, and its creator while they're still an Editor. */
const canDelete = (user: SessionUser, a: Activity) =>
  can(user, "admin") || (a.createdBy === user.id && can(user, "edit"));

// Every route below reads the activity through `load`/`detail` (or VISIBLE in its own query) with the signed-in person
// as viewer, so a private activity answers 404 to anyone not invited, whatever they ask for.
export const activities = new Hono<AppEnv>()
  // Upcoming activities (today on), published and cancelled, each with the viewer's own answer.
  .get("/", async (c) => {
    const today = nyNow().date;
    const user = c.get("user");
    // An activity cancelled by Replace drops off the list: its replacement is there.
    const [acts, mine] = await Promise.all([
      summaries(
        c.env.DB,
        user.id,
        `a.date >= ? and not (a.status = 'cancelled' and exists (select 1 from ${MESSAGES_OF} where t.activity_id = a.id
           and m.kind = 'cancel' and m.body = ?))`,
        [today, REPLACED_NOTE],
      ),
      c.env.DB.prepare(
        "select v.activity_id, v.status from rsvps v join activities a on a.id = v.activity_id where v.user_id = ? and a.date >= ?",
      )
        .bind(user.id, today)
        .all<{ activity_id: string; status: "in" | "out" }>(),
    ]);
    const answer = new Map(mine.results.map((r) => [r.activity_id, r.status]));
    const marks = await markers(c.env.DB, user.id, today);
    return c.json(acts.map((a) => ({ ...a, mine: answer.get(a.id) ?? null, unseen: marks.get(a.id) ?? null })));
  })
  .get("/past", async (c) =>
    c.json(
      await summaries(c.env.DB, c.get("user").id, "a.date < ?", [nyNow().date], "a.date desc, a.start_time desc", 200),
    ),
  )
  .get("/:id", async (c) => c.json(await detail(c.env.DB, c.get("user").id, c.req.param("id"))))
  // Opening an activity records the visit; the reply says when the viewer last caught up, for the "N new" divider.
  .post("/:id/seen", async (c) => {
    const user = c.get("user");
    const act = await load(c.env.DB, user.id, c.req.param("id"));
    return c.json({ seenBefore: await visit(c.env.DB, user.id, act.id) });
  })

  .post("/", requireRole("edit"), validate("json", activityInput), async (c) => {
    const input = c.req.valid("json");
    await checkInput(c.env.DB, input);
    if (input.sport !== "other" && !(await loadSettings(c.env.DB)).sports.includes(input.sport))
      fail(400, "That sport is turned off in Settings");
    const user = c.get("user");
    const plan = input.pollId ? await planFromPoll(c.env.DB, user.id, input.pollId, input.pollOptionId) : null;
    const guests = input.guests ? await guestList(c.env.DB, input.guests, user.id, user.id) : null;
    const clash = await replaceTarget(c.env.DB, user.id, input.replaceId, input.date, input.sport, Boolean(guests));
    const id = newId();
    const now = nowIso();
    await c.env.DB.batch([
      ...(clash ? cancelReplaced(c.env.DB, clash.id, user.id, now) : []),
      c.env.DB.prepare(
        `insert into activities (id, sport, icon, title, date, start_time, end_time, spot_id, outdoor, pace_mph, details, notes,
                                 status, private, created_by, updated_by, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?)`,
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
        Number(Boolean(guests)),
        user.id,
        user.id,
        now,
        now,
      ),
      ...(guests ? guestRows(c.env.DB, id, guests.ids) : []),
      ...routeRows(c.env.DB, id, input.routes),
      ...(plan ? [linkPoll(c.env.DB, plan.poll.id, id)] : []),
      c.env.DB.prepare("delete from drafts where user_id = ?").bind(user.id),
      audit(c.env.DB, user.id, "publish", "activity", id, input),
    ]);
    if (clash) c.executionCtx.waitUntil(notifyReplaced(c.env, clash.id));
    const created = await detail(c.env.DB, user.id, id);
    c.executionCtx.waitUntil(announce(c.env, created, user, guests ? { invited: guests.ids } : undefined));
    if (plan) c.executionCtx.waitUntil(pollPlanned(c.env, plan, id, activityName(created), user));
    return c.json(created, 201);
  })

  // Any Editor can change a public activity; a private one only the Editors and Admins invited (the rest can't see it).
  .put("/:id", requireRole("edit"), validate("json", activityUpdate), async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const user = c.get("user");
    const cur = await load(c.env.DB, user.id, id);
    if (cur.date < nyNow().date) fail(409, PAST);
    if (input.sport !== cur.sport) fail(400, "The sport can't change; post a new activity instead");
    if (input.baseUpdatedAt !== cur.updatedAt) fail(409, STALE);
    if (!cur.private && input.guests) fail(400, "A public activity can't be made private");
    await checkInput(c.env.DB, input, cur.spotId);
    // A private activity stays private (with a new guest list, or the same one if none is sent) unless the editor asks to
    // make it public; that's never the default, so an old app that doesn't know about guests can't do it by accident.
    const madePublic = cur.private && input.makePublic;
    const stillPrivate = cur.private && !madePublic;
    const current = cur.private
      ? (
          await c.env.DB.prepare("select user_id from activity_guests where activity_id = ?")
            .bind(id)
            .all<{ user_id: string }>()
        ).results.map((g) => g.user_id)
      : [];
    const guests =
      stillPrivate && input.guests ? await guestList(c.env.DB, input.guests, cur.createdBy, user.id, current) : null;
    const clash =
      cur.status === "published"
        ? await replaceTarget(c.env.DB, user.id, input.replaceId, input.date, input.sport, stillPrivate, id)
        : null;
    // Only a published activity announces changes; editing a cancelled one stays quiet until it's restored.
    const what = cur.status === "published" ? await changes(c.env.DB, cur, input) : [];
    const now = nowIso();
    const db = c.env.DB;
    await db
      .batch([
        // Re-checked inside the transaction: json('stale') fails, rolling back the batch, if it changed meanwhile
        // (a guest list change counts, so someone just removed can't save either).
        db
          .prepare(
            "select case when (select updated_at from activities where id = ?) = ? then 1 else json('stale') end",
          )
          .bind(id, cur.updatedAt),
        ...(clash ? cancelReplaced(db, clash.id, user.id, now) : []),
        db
          .prepare(
            `update activities set icon = ?, title = ?, date = ?, start_time = ?, end_time = ?, spot_id = ?, outdoor = ?,
                                   pace_mph = ?, details = ?, notes = ?, private = ?, updated_by = ?, updated_at = ? where id = ?`,
          )
          .bind(
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
            Number(stillPrivate),
            user.id,
            now,
            id,
          ),
        ...(madePublic ? [db.prepare("delete from activity_guests where activity_id = ?").bind(id)] : []),
        ...(stillPrivate ? guestRows(db, id, guests?.ids ?? current) : []),
        ...routeRows(db, id, input.routes),
        ...(what.length ? [systemMessage(db, id, "update", what.join(" · "))] : []),
        db.prepare("delete from drafts where user_id = ?").bind(user.id),
        audit(db, user.id, "update", "activity", id, input),
      ])
      .catch((e) => {
        if (/malformed JSON/i.test(String(e))) fail(409, STALE);
        throw e;
      });
    if (clash) c.executionCtx.waitUntil(notifyReplaced(c.env, clash.id));
    const updated = await detail(db, user.id, id);
    const added = guests?.added ?? [];
    // "Updated" goes to those who knew it before: not the team when it just went public, not people just invited. They
    // hear about it as new instead: the newly invited by name, the team as a new activity (minus the people invited).
    if (what.length)
      c.executionCtx.waitUntil(
        notifyActivity(c.env, id, subject(updated, "Updated"), what.join(" · "), {
          answer: true,
          ...(madePublic ? { to: current } : { except: added }),
        }),
      );
    if (updated.status === "published" && added.length)
      c.executionCtx.waitUntil(announce(c.env, updated, user, { invited: added }));
    if (updated.status === "published" && madePublic)
      c.executionCtx.waitUntil(announce(c.env, updated, user, { except: current }));
    return c.json(updated);
  })

  .post("/:id/cancel", requireRole("edit"), async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const cur = await load(c.env.DB, user.id, id);
    if (cur.date < nyNow().date) fail(409, PAST);
    if (cur.status === "cancelled") return c.json(await detail(c.env.DB, user.id, id));
    await c.env.DB.batch([
      stillVisible(c.env.DB, id, user.id),
      c.env.DB.prepare("update activities set status = 'cancelled', updated_by = ?, updated_at = ? where id = ?").bind(
        user.id,
        nowIso(),
        id,
      ),
      systemMessage(c.env.DB, id, "cancel", "Cancelled."),
      audit(c.env.DB, user.id, "cancel", "activity", id),
    ]).catch(gone);
    c.executionCtx.waitUntil(notifyActivity(c.env, id, subject(cur, "Cancelled"), "See Messages on the activity."));
    return c.json(await detail(c.env.DB, user.id, id));
  })

  .post("/:id/restore", requireRole("edit"), async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const cur = await load(c.env.DB, user.id, id);
    if (cur.date < nyNow().date) fail(409, PAST);
    if (cur.status === "published") return c.json(await detail(c.env.DB, user.id, id));
    await c.env.DB.batch([
      stillVisible(c.env.DB, id, user.id),
      c.env.DB.prepare("update activities set status = 'published', updated_by = ?, updated_at = ? where id = ?").bind(
        user.id,
        nowIso(),
        id,
      ),
      systemMessage(c.env.DB, id, "restore", "Back on."),
      audit(c.env.DB, user.id, "restore", "activity", id),
    ]).catch(gone);
    c.executionCtx.waitUntil(notifyActivity(c.env, id, subject(cur, "Back on"), "Happening as planned."));
    return c.json(await detail(c.env.DB, user.id, id));
  })

  // Admins and the activity's creator: removes it with its routes, guests, RSVPs and messages for good. People going to
  // an upcoming one are told; the audit log keeps what it was.
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const cur = await load(c.env.DB, user.id, id);
    if (!canDelete(user, cur)) fail(403, "Only its creator or an Admin can delete this");
    const { results: going } = await c.env.DB.prepare(
      "select user_id from rsvps where activity_id = ? and status = 'in' and user_id != ?",
    )
      .bind(id, user.id)
      .all<{ user_id: string }>();
    const db = c.env.DB;
    await db
      .batch([
        stillVisible(db, id, user.id),
        db.prepare("delete from activity_seen where activity_id = ?").bind(id),
        ...deleteThread(db, { kind: "activity", id }),
        db.prepare("delete from rsvps where activity_id = ?").bind(id),
        db.prepare("delete from activity_guests where activity_id = ?").bind(id),
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
      ])
      .catch(gone);
    if (cur.status === "published" && cur.date >= nyNow().date)
      c.executionCtx.waitUntil(
        notifyActivity(c.env, id, subject(cur, "Deleted"), `Removed by ${firstName(user.name)}.`, {
          to: going.map((g) => g.user_id),
          gone: true,
          url: "/",
        }),
      );
    return c.body(null, 204);
  })

  // RSVP: In / Out (route label only for In with an alternate route), or null to clear.
  .put("/:id/rsvp", validate("json", rsvpInput), async (c) => {
    const id = c.req.param("id");
    const { status, routeLabel } = c.req.valid("json");
    const user = c.get("user");
    const act = await load(c.env.DB, user.id, id);
    if (act.status !== "published" || act.date < nyNow().date) fail(409, "RSVP is closed");
    const label =
      status === "in" && act.routes.length > 1 && act.routes.some((r) => r.label === routeLabel) ? routeLabel : null;
    await c.env.DB.batch([
      stillVisible(c.env.DB, id, user.id),
      status
        ? c.env.DB.prepare(
            `insert into rsvps (activity_id, user_id, status, route_label, updated_at) values (?, ?, ?, ?, ?)
             on conflict (activity_id, user_id) do update set status = excluded.status, route_label = excluded.route_label,
             updated_at = excluded.updated_at`,
          ).bind(id, user.id, status, label, nowIso())
        : c.env.DB.prepare("delete from rsvps where activity_id = ? and user_id = ?").bind(id, user.id),
    ]).catch(gone);
    return c.json(await detail(c.env.DB, user.id, id));
  })

  // Messages: anyone who can see an upcoming published activity can post or reply (one level).
  .post("/:id/messages", validate("json", messageInput), async (c) => {
    const id = c.req.param("id");
    const { body, parentId } = c.req.valid("json");
    const user = c.get("user");
    const act = await load(c.env.DB, user.id, id);
    if (act.date < nyNow().date) fail(409, "Posting is closed on past activities");
    if (act.status !== "published") fail(409, "Posting is closed on cancelled activities");
    if (parentId) {
      if (!(await checkParent(c.env.DB, { kind: "activity", id }, parentId)))
        fail(400, "Replies go to a top-level message");
    }
    await c.env.DB.batch([
      stillVisible(c.env.DB, id, user.id),
      postMessage(c.env.DB, { kind: "activity", id }, { userId: user.id, parentId, body }),
    ]).catch(gone);
    c.executionCtx.waitUntil(notifyMentions(c.env, id, user.id, body));
    return c.json(await detail(c.env.DB, user.id, id), 201);
  });
