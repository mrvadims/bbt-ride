// Date polls (DESIGN.md → Date polls): an Editor asks which day or block of days works; the people asked answer In /
// Maybe / Out per option, see each other's answers and talk in the poll's thread; "Plan this" turns an option into an
// activity (activities.ts calls planFromPoll) and closes the poll. A private poll is seen only by the people picked,
// its creator among them: every route checks pollVisible, so anyone else gets the same 404 as for a missing poll.
import { Hono } from "hono";
import {
  GUESTS_MAX,
  messageInput,
  type PollAnswer,
  type PollDetail,
  type PollSummary,
  pollAnswers,
  pollEdit,
  pollInput,
  threadNotifyInput,
} from "../../shared/api.ts";
import { firstName, mentionIds, plainMentions } from "../../shared/people.ts";
import { byDate, defaultCloses, lastDay, optionLabel, optionsProblem } from "../../shared/polls.ts";
import { SPORT_LABEL, type Sport } from "../../shared/sports.ts";
import { addDays, nyNow } from "../../shared/time.ts";
import { type AppEnv, can, requireRole, type SessionUser } from "../app.ts";
import { notifyActivity, notifyPoll } from "../push.ts";
import { notifyThread, setThreadNotify, threadNotify } from "../thread-notify.ts";
import {
  checkParent,
  deleteThread,
  type MessageRow,
  messageOf,
  postMessage,
  readThread,
  threadMessages,
} from "../threads.ts";
import { audit, fail, newId, nowIso, pollVisible, visible } from "../util.ts";
import { validate } from "../validate.ts";

const NOT_FOUND = "Date poll not found";
const RECENT_DAYS = 120; // closed polls stay listed this long

interface PollRow {
  id: string;
  title: string;
  note: string;
  sport: Sport | null;
  private: number;
  closes_on: string;
  closed_at: string | null;
  activity_id: string | null;
  created_by: string | null;
  by_name: string | null;
  created_at: string;
  updated_at: string;
  answered: number;
  answered_count: number;
  asked_count: number;
  new_messages: number;
}

/** Summaries of the polls matching `where` (on alias p; its own parameters from ?3) that `viewer` may see, newest
 * first, each with its options in date order. */
async function summaries(db: D1Database, viewer: string, where: string, binds: unknown[]) {
  const { results } = await db
    .prepare(
      `select p.id, p.title, p.note, p.sport, p.private, p.closes_on, p.closed_at, p.activity_id, p.created_by,
              u.name as by_name, p.created_at, p.updated_at,
              exists (select 1 from date_poll_answers a join date_poll_options o on o.id = a.option_id
                      where o.poll_id = p.id and a.user_id = ?1) as answered,
              (select count(distinct a.user_id) from date_poll_answers a join date_poll_options o on o.id = a.option_id
               join "user" m on m.id = a.user_id where o.poll_id = p.id and coalesce(m.banned, 0) = 0) as answered_count,
              case when p.private = 1
                then (select count(*) from date_poll_guests g join "user" m on m.id = g.user_id
                      where g.poll_id = p.id and coalesce(m.banned, 0) = 0)
                else (select count(*) from "user" m where coalesce(m.banned, 0) = 0) end as asked_count,
              (select count(*) from messages m join threads t on t.id = m.thread_id
               where t.poll_id = p.id and m.kind = 'user' and m.deleted_at is null and m.user_id is not ?1
                 and m.created_at > coalesce((select s.seen_at from thread_seen s where s.thread_id = t.id
                                              and s.user_id = ?1), '')) as new_messages
       from date_polls p left join "user" u on u.id = p.created_by
       where ${pollVisible("?1")} and (${where}) order by p.created_at desc limit 100`,
    )
    .bind(viewer, nyNow().date, ...binds)
    .all<PollRow>();
  if (!results.length) return [];
  const { results: options } = await db
    .prepare(
      `select id, poll_id, starts_on, ends_on from date_poll_options
       where poll_id in (select value from json_each(?)) order by starts_on, ends_on`,
    )
    .bind(JSON.stringify(results.map((r) => r.id)))
    .all<{ id: string; poll_id: string; starts_on: string; ends_on: string }>();
  const today = nyNow().date;
  return results.map((r) => ({
    row: r,
    summary: {
      id: r.id,
      title: r.title,
      sport: r.sport,
      private: Boolean(r.private),
      options: options
        .filter((o) => o.poll_id === r.id)
        .map((o) => ({ id: o.id, startsOn: o.starts_on, endsOn: o.ends_on })),
      closesOn: r.closes_on,
      open: !r.closed_at && r.closes_on >= today,
      createdBy: r.created_by,
      createdByName: r.by_name,
      createdAt: r.created_at,
      answered: Boolean(r.answered),
      answeredCount: r.answered_count,
      askedCount: r.asked_count,
      activityId: r.activity_id,
      newMessages: r.new_messages,
    } satisfies PollSummary,
  }));
}

/** The poll, if the viewer may see it; else 404. */
async function load(db: D1Database, viewer: string, id: string) {
  const [p] = await summaries(db, viewer, "p.id = ?3", [id]);
  return p ?? fail(404, NOT_FOUND);
}

/** The people a poll asks who haven't been disabled: its guests, or the whole team. */
const askedSql = (priv: boolean) =>
  priv
    ? `select u.id, u.name from date_poll_guests g join "user" u on u.id = g.user_id
       where g.poll_id = ?1 and coalesce(u.banned, 0) = 0`
    : `select u.id, u.name from "user" u where coalesce(u.banned, 0) = 0`;

export async function pollDetail(db: D1Database, viewer: string, id: string): Promise<PollDetail> {
  const { row, summary } = await load(db, viewer, id);
  const [[answers, notes, guests, notYet, messages, act], notify] = await Promise.all([
    db.batch<Record<string, unknown>>([
      db
        .prepare(
          `select a.option_id, a.user_id, u.name, a.status, a.note from date_poll_answers a
         join date_poll_options o on o.id = a.option_id join "user" u on u.id = a.user_id
         where o.poll_id = ? and coalesce(u.banned, 0) = 0 order by a.updated_at`,
        )
        .bind(id),
      db
        .prepare(
          `select n.user_id, u.name, n.note from date_poll_notes n join "user" u on u.id = n.user_id
         where n.poll_id = ? and coalesce(u.banned, 0) = 0 order by n.updated_at`,
        )
        .bind(id),
      db
        .prepare(
          `select g.user_id, u.name from date_poll_guests g join "user" u on u.id = g.user_id
         where g.poll_id = ?1 and coalesce(u.banned, 0) = 0 order by g.user_id = ?2 desc, u.name`,
        )
        .bind(id, row.created_by ?? ""),
      db
        .prepare(
          `select x.id as user_id, x.name from (${askedSql(Boolean(row.private))}) x
         where not exists (select 1 from date_poll_answers a join date_poll_options o on o.id = a.option_id
                           where o.poll_id = ?1 and a.user_id = x.id)
         order by x.name collate nocase`,
        )
        .bind(id),
      threadMessages(db, { kind: "poll", id }),
      db
        .prepare(
          `select a.title, a.sport, (select rc.name from activity_routes ar
           left join route_cache rc on rc.rwgps_route_id = ar.rwgps_route_id where ar.activity_id = a.id
           order by ar.sort limit 1) as route_name
         from activities a where a.id = ?1 and ${visible("?2")}`,
        )
        .bind(row.activity_id ?? "", viewer),
    ]),
    threadNotify(db, { kind: "poll", id }, viewer),
  ]);
  type A = { option_id: string; user_id: string; name: string; status: PollAnswer; note: string | null };
  const a = (act?.results?.[0] ?? null) as { title: string; sport: Sport; route_name: string | null } | null;
  return {
    ...summary,
    note: row.note,
    updatedAt: row.updated_at,
    options: summary.options.map((o) => ({
      ...o,
      answers: ((answers?.results ?? []) as A[])
        .filter((x) => x.option_id === o.id)
        .map((x) => ({ userId: x.user_id, name: x.name, status: x.status, note: x.note })),
    })),
    notes: ((notes?.results ?? []) as { user_id: string; name: string; note: string }[]).map((n) => ({
      userId: n.user_id,
      name: n.name,
      note: n.note,
    })),
    guests: row.private
      ? ((guests?.results ?? []) as { user_id: string; name: string }[]).map((g) => ({
          userId: g.user_id,
          name: g.name,
        }))
      : [],
    notYet: ((notYet?.results ?? []) as { user_id: string; name: string }[]).map((n) => ({
      userId: n.user_id,
      name: n.name,
    })),
    messages: ((messages?.results ?? []) as unknown as MessageRow[]).map(messageOf),
    activityTitle: a ? a.title || a.route_name || SPORT_LABEL[a.sport] : null,
    notify,
  };
}

/** Tells the people a new message mentions (not its author); notifyPoll keeps it to the people the poll asks. */
async function notifyMentions(env: Env, p: PollSummary, author: SessionUser, body: string) {
  const ids = mentionIds(body).filter((id) => id !== author.id);
  if (!ids.length) return;
  const { results } = await env.DB.prepare(`select id, name from "user" where id in (select value from json_each(?))`)
    .bind(JSON.stringify(ids))
    .all<{ id: string; name: string }>();
  const names = new Map(results.map((r) => [r.id, r.name]));
  const text = plainMentions(body, (id) => (id === author.id ? author.name : names.get(id)));
  await notifyPoll(env, p.id, `${firstName(author.name)} mentioned you · ${p.title}`, text.slice(0, 300), { to: ids });
}

/** Its creator while still an Editor, or an Admin (as for deleting an activity). */
const manages = (user: SessionUser, p: PollSummary) =>
  (p.createdBy === user.id && can(user, "edit")) || can(user, "admin");

/** Only open polls take answers, nudges and changes to when they close. */
const mustBeOpen = (p: PollSummary) => {
  if (!p.open) fail(409, "This date poll is closed");
};

/** "Plan this": checks the option belongs to a poll the planner may see (activities.ts, before publishing). */
export async function planFromPoll(db: D1Database, viewer: string, pollId: string, optionId: string | null) {
  const { summary } = await load(db, viewer, pollId);
  if (summary.activityId) fail(409, "This date poll is already planned");
  const option = summary.options.find((o) => o.id === optionId) ?? fail(400, "Pick one of the poll's dates");
  return { poll: summary, option };
}

/** First in the batch that publishes from "Plan this": fails it (nothing is written) if another publish planned the poll
 * a moment ago, so two Editors pressing Publish together can't both plan it. */
export const stillUnplanned = (db: D1Database, pollId: string) =>
  db
    .prepare(
      "select case when exists (select 1 from date_polls where id = ? and activity_id is null) then 1 else json('planned') end",
    )
    .bind(pollId);

/** "Plan this", in the batch that publishes the activity: links it to the poll and closes the poll. */
export const linkPoll = (db: D1Database, pollId: string, activityId: string) =>
  db
    .prepare("update date_polls set activity_id = ?, closed_at = coalesce(closed_at, ?), updated_at = ? where id = ?")
    .bind(activityId, nowIso(), nowIso(), pollId);

/** After "Plan this" published the activity: tells those In or Maybe for that option (not the planner). It goes through
 * the activity's notifications, so a private activity reaches only its guests, whoever answered the poll. */
export async function pollPlanned(
  env: Env,
  plan: { poll: PollSummary; option: { id: string; startsOn: string; endsOn: string } },
  activityId: string,
  activityName: string,
  author: SessionUser,
) {
  const { results } = await env.DB.prepare(
    "select user_id from date_poll_answers where option_id = ? and status in ('in', 'maybe') and user_id != ?",
  )
    .bind(plan.option.id, author.id)
    .all<{ user_id: string }>();
  await notifyActivity(
    env,
    activityId,
    `Planned: ${plan.poll.title}`,
    `${optionLabel(plan.option)} · ${activityName}`,
    {
      to: results.map((r) => r.user_id),
    },
  );
}

export const polls = new Hono<AppEnv>()
  // The polls the viewer is asked on: open ones, and those closed in the last few months (closed early, or past their
  // closing date; dates compare as text, so a closed_at timestamp works against a YYYY-MM-DD day).
  .get("/", async (c) => {
    const list = await summaries(
      c.env.DB,
      c.get("user").id,
      "(p.closed_at is null and p.closes_on >= ?2) or coalesce(p.closed_at, p.closes_on) >= ?3",
      [addDays(nyNow().date, -RECENT_DAYS)],
    );
    return c.json(list.map((p) => p.summary));
  })
  .get("/:id", async (c) => c.json(await pollDetail(c.env.DB, c.get("user").id, c.req.param("id"))))
  // Opening it: when the viewer last read its thread (for the "new" divider), and records this visit.
  .post("/:id/seen", async (c) => {
    const user = c.get("user");
    const { summary } = await load(c.env.DB, user.id, c.req.param("id"));
    return c.json({ seenBefore: await readThread(c.env.DB, { kind: "poll", id: summary.id }, user.id) });
  })

  .post("/", requireRole("edit"), validate("json", pollInput), async (c) => {
    const input = c.req.valid("json");
    const user = c.get("user");
    const today = nyNow().date;
    const problem = optionsProblem(input.options, today);
    if (problem) fail(400, problem);
    const options = byDate(input.options);
    const closesOn = input.closesOn ?? defaultCloses(options, today);
    if (closesOn < today || closesOn > lastDay(options))
      fail(400, "Answers must close between today and the last date");
    let guests: string[] | null = null;
    if (input.guests) {
      guests = [...new Set([user.id, ...input.guests])];
      if (guests.length > GUESTS_MAX) fail(400, `Ask at most ${GUESTS_MAX} people`);
      if (guests.length < 2) fail(400, "Pick who to ask");
      const { results } = await c.env.DB.prepare(
        `select id from "user" where coalesce(banned, 0) = 0 and id in (select value from json_each(?))`,
      )
        .bind(JSON.stringify(guests))
        .all<{ id: string }>();
      if (results.length !== guests.length) fail(400, "Someone picked isn't on the team");
    }
    const id = newId();
    const now = nowIso();
    const db = c.env.DB;
    await db.batch([
      db
        .prepare(
          `insert into date_polls (id, title, note, sport, private, closes_on, created_by, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, input.title, input.note, input.sport, Number(Boolean(guests)), closesOn, user.id, now, now),
      ...options.map((o) =>
        db
          .prepare("insert into date_poll_options (id, poll_id, starts_on, ends_on) values (?, ?, ?, ?)")
          .bind(newId(), id, o.startsOn, o.endsOn),
      ),
      ...(guests
        ? [
            db
              .prepare("insert into date_poll_guests (poll_id, user_id) select ?, value from json_each(?)")
              .bind(id, JSON.stringify(guests)),
          ]
        : []),
      audit(db, user.id, "publish", "poll", id, { title: input.title, options, closesOn, guests }),
    ]);
    const n = options.length;
    c.executionCtx.waitUntil(
      notifyPoll(
        c.env,
        id,
        `${firstName(user.name)} started a date poll`,
        `${input.title} · ${n === 1 ? optionLabel(options[0] as (typeof options)[number]) : `${n} options`}. Which work for you?`,
        guests ? { to: guests, except: [user.id] } : { sport: input.sport, except: [user.id] },
      ),
    );
    return c.json(await pollDetail(db, user.id, id), 201);
  })

  // Its creator or an Admin: the title, the note, and when answers close.
  .put("/:id", validate("json", pollEdit), async (c) => {
    const user = c.get("user");
    const { summary: p } = await load(c.env.DB, user.id, c.req.param("id"));
    if (!manages(user, p)) fail(403, "Only its creator or an Admin can change this poll");
    const input = c.req.valid("json");
    if (input.closesOn !== p.closesOn) {
      mustBeOpen(p);
      if (input.closesOn < nyNow().date || input.closesOn > lastDay(p.options))
        fail(400, "Answers must close between today and the last date");
    }
    // Saved only if nobody changed it since the editor loaded it (two saves at the same moment can't both win).
    const saved = await c.env.DB.prepare(
      "update date_polls set title = ?, note = ?, closes_on = ?, updated_at = ? where id = ? and updated_at = ?",
    )
      .bind(input.title, input.note, input.closesOn, nowIso(), p.id, input.baseUpdatedAt)
      .run();
    if (!saved.meta.changes) fail(409, "Someone else changed this poll. Reload to see the latest.");
    await audit(c.env.DB, user.id, "update", "poll", p.id, {
      title: input.title,
      note: input.note,
      closesOn: input.closesOn,
    }).run();
    return c.json(await pollDetail(c.env.DB, user.id, p.id));
  })
  .post("/:id/close", async (c) => {
    const user = c.get("user");
    const { summary: p } = await load(c.env.DB, user.id, c.req.param("id"));
    if (!manages(user, p)) fail(403, "Only its creator or an Admin can close this poll");
    await c.env.DB.batch([
      c.env.DB.prepare("update date_polls set closed_at = coalesce(closed_at, ?), updated_at = ? where id = ?").bind(
        nowIso(),
        nowIso(),
        p.id,
      ),
      audit(c.env.DB, user.id, "close", "poll", p.id),
    ]);
    return c.json(await pollDetail(c.env.DB, user.id, p.id));
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const { summary: p } = await load(c.env.DB, user.id, c.req.param("id"));
    if (!manages(user, p)) fail(403, "Only its creator or an Admin can delete this poll");
    const db = c.env.DB;
    await db.batch([
      ...deleteThread(db, { kind: "poll", id: p.id }),
      db.prepare("delete from date_polls where id = ?").bind(p.id), // options, answers, notes and guests go with it
      audit(db, user.id, "delete", "poll", p.id, { title: p.title }),
    ]);
    return c.body(null, 204);
  })

  // Anyone asked, while it's open: the answers that changed (null clears one) and/or the note on the whole poll.
  .put("/:id/answers", validate("json", pollAnswers), async (c) => {
    const user = c.get("user");
    const { summary: p } = await load(c.env.DB, user.id, c.req.param("id"));
    mustBeOpen(p);
    const { answers, note } = c.req.valid("json");
    const ids = new Set(p.options.map((o) => o.id));
    if (answers.some((a) => !ids.has(a.optionId))) fail(400, "That's not one of this poll's dates");
    const db = c.env.DB;
    const now = nowIso();
    const writes = answers.map((a) =>
      a.status
        ? db
            .prepare(
              `insert into date_poll_answers (option_id, user_id, status, note, updated_at) values (?, ?, ?, ?, ?)
               on conflict (option_id, user_id) do update set status = excluded.status, note = excluded.note,
               updated_at = excluded.updated_at`,
            )
            .bind(a.optionId, user.id, a.status, a.note || null, now)
        : db.prepare("delete from date_poll_answers where option_id = ? and user_id = ?").bind(a.optionId, user.id),
    );
    if (note !== undefined)
      writes.push(
        note
          ? db
              .prepare(
                `insert into date_poll_notes (poll_id, user_id, note, updated_at) values (?, ?, ?, ?)
                 on conflict (poll_id, user_id) do update set note = excluded.note, updated_at = excluded.updated_at`,
              )
              .bind(p.id, user.id, note, now)
          : db.prepare("delete from date_poll_notes where poll_id = ? and user_id = ?").bind(p.id, user.id),
      );
    if (writes.length) await db.batch(writes);
    return c.json(await pollDetail(db, user.id, p.id));
  })

  // Its creator or an Admin, while it's open: one notification to everyone asked who hasn't answered.
  .post("/:id/nudge", async (c) => {
    const user = c.get("user");
    const detail = await pollDetail(c.env.DB, user.id, c.req.param("id"));
    if (!manages(user, detail)) fail(403, "Only its creator or an Admin can nudge");
    mustBeOpen(detail);
    const to = detail.notYet.map((n) => n.userId).filter((id) => id !== user.id);
    c.executionCtx.waitUntil(
      notifyPoll(
        c.env,
        detail.id,
        `Which dates work? ${detail.title}`,
        `${firstName(user.name)} is waiting for your answer.`,
        {
          to,
        },
      ),
    );
    return c.json({ nudged: to.length });
  })

  // Messages: anyone asked can post or reply (one level), open or closed.
  .post("/:id/messages", validate("json", messageInput), async (c) => {
    const user = c.get("user");
    const { summary: p } = await load(c.env.DB, user.id, c.req.param("id"));
    const { body, parentId } = c.req.valid("json");
    const owner = { kind: "poll" as const, id: p.id };
    if (parentId && !(await checkParent(c.env.DB, owner, parentId))) fail(400, "Replies go to a top-level message");
    await postMessage(c.env.DB, owner, { userId: user.id, parentId, body }).run();
    c.executionCtx.waitUntil(notifyMentions(c.env, p, user, body));
    c.executionCtx.waitUntil(notifyThread(c.env, owner, { name: p.title, url: `/polls/${p.id}` }, user, body));
    return c.json(await pollDetail(c.env.DB, user.id, p.id), 201);
  })
  // The Messages panel's switch: follow or mute this poll's thread.
  .put("/:id/notify", validate("json", threadNotifyInput), async (c) => {
    const user = c.get("user");
    const { summary: p } = await load(c.env.DB, user.id, c.req.param("id"));
    await setThreadNotify(c.env.DB, { kind: "poll", id: p.id }, user.id, c.req.valid("json").on).run();
    return c.json(await pollDetail(c.env.DB, user.id, p.id));
  });
