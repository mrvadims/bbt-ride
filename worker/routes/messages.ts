// Editing and deleting a message, in any thread (DESIGN.md → Messages): authors edit their own while the thread is open
// for posting; authors delete their own (not on past activities); Editors and Admins can always delete (moderation).
// The message must be in a thread whose owner the viewer may see (visible / pollVisible), else 404. Each call answers
// with the owner as it now is, like posting does.
import { Hono } from "hono";
import { messageEdit } from "../../shared/api.ts";
import { nyNow } from "../../shared/time.ts";
import { type AppEnv, can } from "../app.ts";
import { audit, fail, nowIso, pollVisible, visible } from "../util.ts";
import { validate } from "../validate.ts";
import { detail } from "./activities.ts";
import { pollDetail } from "./polls.ts";

const NOT_FOUND = "Message not found";

interface Found {
  user_id: string | null;
  deleted_at: string | null;
  activity_id: string | null;
  poll_id: string | null;
  date: string | null; // an activity's day
  status: string | null; // an activity's status
}

/** A person's message in a thread the viewer may see, with what the rules need; else 404. */
async function messageFor(db: D1Database, viewer: string, id: string) {
  const m = await db
    .prepare(
      `select m.user_id, m.deleted_at, t.activity_id, t.poll_id, a.date, a.status
       from messages m join threads t on t.id = m.thread_id
       left join activities a on a.id = t.activity_id
       left join date_polls p on p.id = t.poll_id
       where m.id = ?1 and m.kind = 'user'
         and ((t.activity_id is not null and ${visible("?2")}) or (t.poll_id is not null and ${pollVisible("?2")}))`,
    )
    .bind(id, viewer)
    .first<Found>();
  return m ?? fail(404, NOT_FOUND);
}

/** The thread's owner as it now is, for the reply. */
const owner = (db: D1Database, viewer: string, m: Found) =>
  m.activity_id ? detail(db, viewer, m.activity_id) : pollDetail(db, viewer, m.poll_id as string);

export const messages = new Hono<AppEnv>()
  .patch("/:id", validate("json", messageEdit), async (c) => {
    const user = c.get("user");
    const m = await messageFor(c.env.DB, user.id, c.req.param("id"));
    if (m.deleted_at) return fail(404, NOT_FOUND);
    if (m.user_id !== user.id) fail(403, "Only the author can edit a message");
    if (m.activity_id) {
      if ((m.date ?? "") < nyNow().date) fail(409, "Messages on past activities can't be edited");
      if (m.status !== "published") fail(409, "Messages on cancelled activities can't be edited"); // as for posting
    }
    const { body } = c.req.valid("json");
    await c.env.DB.prepare("update messages set body = ?, edited_at = ? where id = ?")
      .bind(body, nowIso(), c.req.param("id"))
      .run();
    return c.json(await owner(c.env.DB, user.id, m));
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const m = await messageFor(c.env.DB, user.id, c.req.param("id"));
    if (m.deleted_at) return c.json(await owner(c.env.DB, user.id, m)); // already deleted: nothing to do
    const past = Boolean(m.activity_id) && (m.date ?? "") < nyNow().date;
    if (!can(user, "edit") && (m.user_id !== user.id || past)) fail(403, "You can't delete this message");
    await c.env.DB.batch([
      c.env.DB.prepare("update messages set body = '', deleted_at = ? where id = ?").bind(nowIso(), c.req.param("id")),
      ...(m.user_id !== user.id ? [audit(c.env.DB, user.id, "delete", "message", c.req.param("id"))] : []),
    ]);
    return c.json(await owner(c.env.DB, user.id, m));
  });
