// Announcements (DESIGN.md → v2, Announcements): Admins post a message to everyone; each person sees it as a banner
// until they tap Got it, and can read recent ones again from the account menu.
import { Hono } from "hono";
import { type Announcement, type AnnouncementAdmin, announcementEdit, announcementInput } from "../../shared/api.ts";
import { nyNow } from "../../shared/time.ts";
import { type AppEnv, requireRole } from "../app.ts";
import { notifyTeam } from "../push.ts";
import { audit, fail, newId, nowIso } from "../util.ts";
import { validate } from "../validate.ts";

const RECENT_DAYS = 90;
const NOT_FOUND = "Announcement not found";
// Active: not ended and its last day not past (?1 = today in New York).
const ACTIVE = "(n.ended_at is null and (n.ends_on is null or n.ends_on >= ?1))";

interface Row {
  id: string;
  title: string;
  body: string;
  by: string | null;
  created_at: string;
  ends_on: string | null;
  ended_at: string | null;
  active: number;
  seen: number;
}
const shape = (r: Row): Announcement => ({
  id: r.id,
  title: r.title,
  body: r.body,
  by: r.by,
  createdAt: r.created_at,
  endsOn: r.ends_on,
  active: Boolean(r.active),
  seen: Boolean(r.seen),
});
// The columns of Row; `viewer` names the parameter holding the viewer's id.
const columns = (viewer: string) =>
  `n.id, n.title, n.body, u.name as by, n.created_at, n.ends_on, n.ended_at, ${ACTIVE} as active,
   exists (select 1 from announcement_seen s where s.announcement_id = n.id and s.user_id = ${viewer}) as seen`;

const checkEnd = (endsOn: string | null) => {
  if (endsOn && endsOn < nyNow().date) fail(400, "Pick today or a later end date");
};

export const announcements = new Hono<AppEnv>()
  // Everyone: the active ones and the last 90 days', newest first, each with whether the viewer has seen it.
  .get("/", async (c) => {
    const since = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString();
    const { results } = await c.env.DB.prepare(
      `select ${columns("?3")} from announcements n left join "user" u on u.id = n.created_by
       where ${ACTIVE} or n.created_at >= ?2 order by n.created_at desc`,
    )
      .bind(nyNow().date, since, c.get("user").id)
      .all<Row>();
    return c.json(results.map(shape));
  })
  .post("/:id/seen", async (c) => {
    const id = c.req.param("id");
    const r = await c.env.DB.prepare(
      `insert into announcement_seen (announcement_id, user_id, at) select id, ?, ? from announcements where id = ?
       on conflict do nothing`,
    )
      .bind(c.get("user").id, nowIso(), id)
      .run();
    if (!r.meta.changes && !(await c.env.DB.prepare("select 1 from announcements where id = ?").bind(id).first()))
      fail(404, NOT_FOUND);
    return c.body(null, 204);
  })

  // Admins: every announcement (the newest 100) with how many of the team have seen it.
  .get("/all", requireRole("admin"), async (c) => {
    const { results } = await c.env.DB.prepare(
      `select ${columns("?2")},
              (select count(*) from announcement_seen s join "user" m on m.id = s.user_id
               where s.announcement_id = n.id and coalesce(m.banned, 0) = 0) as seen_count,
              (select count(*) from "user" m where coalesce(m.banned, 0) = 0) as team_count
       from announcements n left join "user" u on u.id = n.created_by order by n.created_at desc limit 100`,
    )
      .bind(nyNow().date, c.get("user").id)
      .all<Row & { seen_count: number; team_count: number }>();
    return c.json(
      results.map(
        (r): AnnouncementAdmin => ({
          ...shape(r),
          endedAt: r.ended_at,
          seenCount: r.seen_count,
          teamCount: r.team_count,
        }),
      ),
    );
  })
  // Admins: the members (not disabled) who haven't tapped Got it yet.
  .get("/:id/unseen", requireRole("admin"), async (c) => {
    const id = c.req.param("id");
    if (!(await c.env.DB.prepare("select 1 from announcements where id = ?").bind(id).first())) fail(404, NOT_FOUND);
    const { results } = await c.env.DB.prepare(
      `select id, name from "user" m where coalesce(m.banned, 0) = 0
       and not exists (select 1 from announcement_seen s where s.announcement_id = ? and s.user_id = m.id) order by name`,
    )
      .bind(id)
      .all<{ id: string; name: string }>();
    return c.json(results);
  })
  .post("/", requireRole("admin"), validate("json", announcementInput), async (c) => {
    const { title, body, endsOn, notify } = c.req.valid("json");
    checkEnd(endsOn);
    const user = c.get("user");
    const id = newId();
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `insert into announcements (id, title, body, ends_on, created_by, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, title, body, endsOn, user.id, now, now),
      // The person posting has seen it.
      c.env.DB.prepare("insert into announcement_seen (announcement_id, user_id, at) values (?, ?, ?)").bind(
        id,
        user.id,
        now,
      ),
      audit(c.env.DB, user.id, "publish", "announcement", id, { title, endsOn, notify }),
    ]);
    if (notify) c.executionCtx.waitUntil(notifyTeam(c.env, title, body.slice(0, 300), "/announcements"));
    return c.json({ id }, 201);
  })
  // Fixing a typo or the end date; people who already tapped Got it aren't shown it again.
  .put("/:id", requireRole("admin"), validate("json", announcementEdit), async (c) => {
    const { title, body, endsOn } = c.req.valid("json");
    checkEnd(endsOn);
    const id = c.req.param("id");
    const user = c.get("user");
    const r = await c.env.DB.prepare(
      "update announcements set title = ?, body = ?, ends_on = ?, updated_at = ? where id = ? and ended_at is null",
    )
      .bind(title, body, endsOn, nowIso(), id)
      .run();
    if (!r.meta.changes) fail(404, "Not found, or already ended");
    await audit(c.env.DB, user.id, "update", "announcement", id, { title, endsOn }).run();
    return c.body(null, 204);
  })
  .post("/:id/end", requireRole("admin"), async (c) => {
    const id = c.req.param("id");
    const r = await c.env.DB.prepare("update announcements set ended_at = ? where id = ? and ended_at is null")
      .bind(nowIso(), id)
      .run();
    if (r.meta.changes) await audit(c.env.DB, c.get("user").id, "end", "announcement", id).run();
    else if (!(await c.env.DB.prepare("select 1 from announcements where id = ?").bind(id).first()))
      fail(404, NOT_FOUND);
    return c.body(null, 204);
  });
