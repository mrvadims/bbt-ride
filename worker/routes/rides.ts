// Rides, RSVPs and messages (DESIGN.md → Rides, Plan a ride, Drafts and changes).
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  type Message,
  messageEdit,
  messageInput,
  type RecordedWeather,
  type RideDetail,
  type RideInput,
  type RideSummary,
  type Rsvp,
  rideInput,
  rsvpInput,
} from "../../shared/api.ts";
import type { RideRoute } from "../../shared/ride.ts";
import { dayLabel, fmtTime, hhmmToMin, nyNow } from "../../shared/time.ts";
import { type AppEnv, can, requireRole } from "../app.ts";
import { notifyRide } from "../push.ts";
import { audit, fail, newId, nowIso } from "../util.ts";

interface RideRow {
  id: string;
  date: string;
  rollout: string;
  spot_id: string;
  pace_mph: number;
  notes: string;
  status: "published" | "cancelled";
  observed_json: string | null;
}

/** Ride summaries for rides matching `where` (a condition on table alias r), with routes, counts and the latest update. */
async function summaries(db: D1Database, where: string, binds: unknown[], order = "r.date"): Promise<RideSummary[]> {
  const { results: rides } = await db
    .prepare(
      `select r.id, r.date, r.rollout, r.spot_id, r.pace_mph, r.notes, r.status, r.observed_json from rides r where ${where} order by ${order}`,
    )
    .bind(...binds)
    .all<RideRow>();
  if (!rides.length) return [];
  const ids = rides.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");
  const [routes, rsvps, msgs, updates] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `select rr.ride_id, rr.label, rr.rwgps_route_id, rr.stop_poi, rc.name from ride_routes rr left join route_cache rc on rc.rwgps_route_id = rr.rwgps_route_id where rr.ride_id in (${marks}) order by rr.ride_id, rr.sort`,
      )
      .bind(...ids),
    db
      .prepare(`select ride_id, status, count(*) as n from rsvps where ride_id in (${marks}) group by ride_id, status`)
      .bind(...ids),
    db
      .prepare(
        `select ride_id, count(*) as n from messages where ride_id in (${marks}) and deleted_at is null group by ride_id`,
      )
      .bind(...ids),
    db
      .prepare(
        `select ride_id, body, created_at from messages m where ride_id in (${marks}) and kind = 'update'
         and created_at = (select max(created_at) from messages where ride_id = m.ride_id and kind = 'update')`,
      )
      .bind(...ids),
  ]);
  const by = <T>(rows: Record<string, unknown>[] | undefined, id: string) =>
    (rows ?? []).filter((x) => x.ride_id === id) as T[];
  return rides.map((r) => {
    const counts = by<{ status: string; n: number }>(rsvps?.results, r.id);
    const upd = by<{ body: string; created_at: string }>(updates?.results, r.id)[0];
    return {
      id: r.id,
      date: r.date,
      rollout: r.rollout,
      spotId: r.spot_id,
      pace: r.pace_mph,
      notes: r.notes,
      status: r.status,
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

async function detail(db: D1Database, id: string): Promise<RideDetail> {
  const [ride] = await summaries(db, "r.id = ?", [id]);
  if (!ride) return fail(404, "Ride not found");
  const [rsvps, messages] = await Promise.all([
    db
      .prepare(
        `select v.user_id, u.name, v.status, v.route_label from rsvps v join "user" u on u.id = v.user_id where v.ride_id = ? order by v.updated_at`,
      )
      .bind(id)
      .all<{ user_id: string; name: string; status: "in" | "out"; route_label: string | null }>(),
    db
      .prepare(
        `select m.id, m.parent_id, m.kind, m.user_id, u.name, m.body, m.created_at, m.edited_at, m.deleted_at
         from messages m left join "user" u on u.id = m.user_id where m.ride_id = ? order by m.created_at`,
      )
      .bind(id)
      .all<MessageRow>(),
  ]);
  return {
    ...ride,
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

const publishedOn = (db: D1Database, date: string, except = "") =>
  db
    .prepare("select id from rides where date = ? and status = 'published' and id != ?")
    .bind(date, except)
    .first<{ id: string }>();

/** What riders need to know when a published ride changes (DESIGN.md → Editing a published ride). */
async function changes(db: D1Database, a: RideSummary, b: RideInput): Promise<string[]> {
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
  const out: string[] = [];
  if (a.date !== b.date) out.push(`moved to ${dayLabel(b.date, true)}`);
  if (a.rollout !== b.rollout) out.push(`roll-out ${fmtTime(hhmmToMin(a.rollout))} → ${fmtTime(hhmmToMin(b.rollout))}`);
  if (a.spotId !== b.spotId) out.push(`start ${await spot(a.spotId)} → ${await spot(b.spotId)}`);
  if (routeText(a.routes) !== routeText(b.routes)) out.push(`route ${routeText(b.routes)}`);
  const aStop = a.routes[0]?.stop ?? null;
  const bStop = b.routes[0]?.stop ?? null;
  if (aStop !== bStop) out.push(bStop ? `coffee stop ${bStop}` : "no coffee stop");
  else if ((a.routes[1]?.stop ?? null) !== (b.routes[1]?.stop ?? null))
    out.push(`${b.routes[1]?.label ?? "alternate"} coffee stop updated`);
  if (a.notes !== b.notes) out.push("notes updated");
  return out;
}

const routeRows = (db: D1Database, rideId: string, routes: RideInput["routes"]) => [
  db.prepare("delete from ride_routes where ride_id = ?").bind(rideId),
  ...routes.map((r, i) =>
    db
      .prepare("insert into ride_routes (ride_id, sort, label, rwgps_route_id, stop_poi) values (?, ?, ?, ?, ?)")
      .bind(rideId, i, r.label, r.routeId, r.stop),
  ),
  // A route choice on an RSVP only makes sense while that labelled alternate exists.
  routes.length > 1
    ? db
        .prepare(
          `update rsvps set route_label = null where ride_id = ? and route_label not in (${routes.map(() => "?").join(",")})`,
        )
        .bind(rideId, ...routes.map((r) => r.label))
    : db.prepare("update rsvps set route_label = null where ride_id = ?").bind(rideId),
];
const systemMessage = (db: D1Database, rideId: string, kind: Message["kind"], body: string) =>
  db
    .prepare("insert into messages (id, ride_id, kind, body, created_at) values (?, ?, ?, ?, ?)")
    .bind(newId(), rideId, kind, body, nowIso());

/** The date must be today or later, and the spot active (an archived spot may stay on a ride that already uses it). */
async function checkInput(db: D1Database, input: RideInput, currentSpot?: string) {
  if (input.date < nyNow().date) fail(400, "Pick today or a later date");
  const spot = await db
    .prepare("select archived from spots where id = ?")
    .bind(input.spotId)
    .first<{ archived: number }>();
  if (!spot || (spot.archived && input.spotId !== currentSpot)) fail(400, "Unknown start spot");
}

/** Replacing a ride cancels the one already posted for that date; it keeps its RSVPs and messages in history. */
const cancelReplaced = (db: D1Database, rideId: string, userId: string, now: string) => [
  db
    .prepare("update rides set status = 'cancelled', updated_by = ?, updated_at = ? where id = ?")
    .bind(userId, now, rideId),
  systemMessage(db, rideId, "cancel", "Ride cancelled: replaced by a new plan."),
];
const notifyReplaced = (env: Env, rideId: string, date: string) =>
  notifyRide(env, rideId, `Ride cancelled: ${dayLabel(date)}`, "Replaced by a new plan.");

export const rides = new Hono<AppEnv>()
  // Upcoming rides (today on), published and cancelled.
  .get("/", async (c) => c.json(await summaries(c.env.DB, "r.date >= ?", [nyNow().date])))
  .get("/past", async (c) => c.json(await summaries(c.env.DB, "r.date < ?", [nyNow().date], "r.date desc limit 200")))
  .get("/:id", async (c) => c.json(await detail(c.env.DB, c.req.param("id"))))

  .post("/", requireRole("edit"), zValidator("json", rideInput), async (c) => {
    const input = c.req.valid("json");
    await checkInput(c.env.DB, input);
    const user = c.get("user");
    const clash = await publishedOn(c.env.DB, input.date);
    if (clash && !input.replace) fail(409, "A ride is already posted for that date");
    const id = newId();
    const now = nowIso();
    await c.env.DB.batch([
      ...(clash ? cancelReplaced(c.env.DB, clash.id, user.id, now) : []),
      c.env.DB.prepare(
        "insert into rides (id, date, rollout, spot_id, pace_mph, notes, status, created_by, updated_by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)",
      ).bind(id, input.date, input.rollout, input.spotId, input.pace, input.notes, user.id, user.id, now, now),
      ...routeRows(c.env.DB, id, input.routes),
      c.env.DB.prepare("delete from drafts where user_id = ?").bind(user.id),
      audit(c.env.DB, user.id, "publish", "ride", id, input),
    ]);
    if (clash) c.executionCtx.waitUntil(notifyReplaced(c.env, clash.id, input.date));
    return c.json(await detail(c.env.DB, id), 201);
  })

  .put("/:id", requireRole("edit"), zValidator("json", rideInput), async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const [cur] = await summaries(c.env.DB, "r.id = ?", [id]);
    if (!cur) return fail(404, "Ride not found");
    if (cur.date < nyNow().date) fail(409, "Past rides can't be changed");
    await checkInput(c.env.DB, input, cur.spotId);
    const user = c.get("user");
    const clash = cur.status === "published" ? await publishedOn(c.env.DB, input.date, id) : null;
    if (clash && !input.replace) fail(409, "A ride is already posted for that date");
    // Only a published ride announces changes; editing a cancelled ride stays quiet until it's restored.
    const what = cur.status === "published" ? await changes(c.env.DB, cur, input) : [];
    const now = nowIso();
    await c.env.DB.batch([
      ...(clash ? cancelReplaced(c.env.DB, clash.id, user.id, now) : []),
      c.env.DB.prepare(
        "update rides set date = ?, rollout = ?, spot_id = ?, pace_mph = ?, notes = ?, updated_by = ?, updated_at = ? where id = ?",
      ).bind(input.date, input.rollout, input.spotId, input.pace, input.notes, user.id, now, id),
      ...routeRows(c.env.DB, id, input.routes),
      ...(what.length ? [systemMessage(c.env.DB, id, "update", what.join(" · "))] : []),
      c.env.DB.prepare("delete from drafts where user_id = ?").bind(user.id),
      audit(c.env.DB, user.id, "update", "ride", id, input),
    ]);
    if (clash) c.executionCtx.waitUntil(notifyReplaced(c.env, clash.id, input.date));
    if (what.length)
      c.executionCtx.waitUntil(notifyRide(c.env, id, `Ride updated: ${dayLabel(input.date)}`, what.join(" · ")));
    return c.json(await detail(c.env.DB, id));
  })

  .post("/:id/cancel", requireRole("edit"), async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const [cur] = await summaries(c.env.DB, "r.id = ?", [id]);
    if (!cur) return fail(404, "Ride not found");
    if (cur.date < nyNow().date) fail(409, "Past rides can't be changed");
    if (cur.status === "cancelled") return c.json(await detail(c.env.DB, id));
    await c.env.DB.batch([
      c.env.DB.prepare("update rides set status = 'cancelled', updated_by = ?, updated_at = ? where id = ?").bind(
        user.id,
        nowIso(),
        id,
      ),
      systemMessage(c.env.DB, id, "cancel", "Ride cancelled."),
      audit(c.env.DB, user.id, "cancel", "ride", id),
    ]);
    c.executionCtx.waitUntil(
      notifyRide(c.env, id, `Ride cancelled: ${dayLabel(cur.date)}`, "Check the Riders panel for messages."),
    );
    return c.json(await detail(c.env.DB, id));
  })

  .post("/:id/restore", requireRole("edit"), async (c) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const [cur] = await summaries(c.env.DB, "r.id = ?", [id]);
    if (!cur) return fail(404, "Ride not found");
    if (cur.date < nyNow().date) fail(409, "Past rides can't be changed");
    if (cur.status === "published") return c.json(await detail(c.env.DB, id));
    if (await publishedOn(c.env.DB, cur.date)) fail(409, "Another ride is posted for that date");
    await c.env.DB.batch([
      c.env.DB.prepare("update rides set status = 'published', updated_by = ?, updated_at = ? where id = ?").bind(
        user.id,
        nowIso(),
        id,
      ),
      systemMessage(c.env.DB, id, "restore", "Ride is back on."),
      audit(c.env.DB, user.id, "restore", "ride", id),
    ]);
    c.executionCtx.waitUntil(
      notifyRide(c.env, id, `Ride is back on: ${dayLabel(cur.date)}`, "The ride is happening as planned."),
    );
    return c.json(await detail(c.env.DB, id));
  })

  // RSVP: In / Out (route label only for In on rides with an alternate), or null to clear.
  .put("/:id/rsvp", zValidator("json", rsvpInput), async (c) => {
    const id = c.req.param("id");
    const { status, routeLabel } = c.req.valid("json");
    const [ride] = await summaries(c.env.DB, "r.id = ?", [id]);
    if (!ride) return fail(404, "Ride not found");
    if (ride.status !== "published" || ride.date < nyNow().date) fail(409, "RSVP is closed for this ride");
    const user = c.get("user");
    if (!status) {
      await c.env.DB.prepare("delete from rsvps where ride_id = ? and user_id = ?").bind(id, user.id).run();
    } else {
      const label =
        status === "in" && ride.routes.length > 1 && ride.routes.some((r) => r.label === routeLabel)
          ? routeLabel
          : null;
      await c.env.DB.prepare(
        "insert into rsvps (ride_id, user_id, status, route_label, updated_at) values (?, ?, ?, ?, ?) on conflict (ride_id, user_id) do update set status = excluded.status, route_label = excluded.route_label, updated_at = excluded.updated_at",
      )
        .bind(id, user.id, status, label, nowIso())
        .run();
    }
    return c.json(await detail(c.env.DB, id));
  })

  // Messages: anyone can post or reply (one level) on upcoming published rides.
  .post("/:id/messages", zValidator("json", messageInput), async (c) => {
    const id = c.req.param("id");
    const { body, parentId } = c.req.valid("json");
    const ride = await c.env.DB.prepare("select date, status from rides where id = ?")
      .bind(id)
      .first<{ date: string; status: string }>();
    if (!ride) return fail(404, "Ride not found");
    if (ride.date < nyNow().date) fail(409, "Posting is closed on past rides");
    if (ride.status !== "published") fail(409, "Posting is closed on cancelled rides");
    if (parentId) {
      const parent = await c.env.DB.prepare("select parent_id from messages where id = ? and ride_id = ?")
        .bind(parentId, id)
        .first<{ parent_id: string | null }>();
      if (!parent || parent.parent_id) fail(400, "Replies go to a top-level message");
    }
    await c.env.DB.prepare(
      "insert into messages (id, ride_id, user_id, parent_id, body, created_at) values (?, ?, ?, ?, ?, ?)",
    )
      .bind(newId(), id, c.get("user").id, parentId, body, nowIso())
      .run();
    return c.json(await detail(c.env.DB, id), 201);
  });

// Editing and deleting a message: authors edit their own; authors, editors and admins delete (soft delete).
export const messages = new Hono<AppEnv>()
  .patch("/:id", zValidator("json", messageEdit), async (c) => {
    const m = await c.env.DB.prepare(
      "select m.ride_id, m.user_id, m.deleted_at, r.date from messages m join rides r on r.id = m.ride_id where m.id = ?",
    )
      .bind(c.req.param("id"))
      .first<{ ride_id: string; user_id: string | null; deleted_at: string | null; date: string }>();
    if (!m || m.deleted_at) return fail(404, "Message not found");
    if (m.user_id !== c.get("user").id) fail(403, "Only the author can edit a message");
    if (m.date < nyNow().date) fail(409, "Messages on past rides can't be edited");
    await c.env.DB.prepare("update messages set body = ?, edited_at = ? where id = ?")
      .bind(c.req.valid("json").body, nowIso(), c.req.param("id"))
      .run();
    return c.json(await detail(c.env.DB, m.ride_id));
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const m = await c.env.DB.prepare(
      "select m.ride_id, m.user_id, m.kind, r.date from messages m join rides r on r.id = m.ride_id where m.id = ?",
    )
      .bind(c.req.param("id"))
      .first<{ ride_id: string; user_id: string | null; kind: string; date: string }>();
    if (m?.kind !== "user") return fail(404, "Message not found");
    // Authors delete their own on upcoming rides; editors and admins can always delete (moderation).
    if (!can(user, "edit") && (m.user_id !== user.id || m.date < nyNow().date))
      fail(403, "You can't delete this message");
    await c.env.DB.batch([
      c.env.DB.prepare("update messages set body = '', deleted_at = ? where id = ?").bind(nowIso(), c.req.param("id")),
      ...(m.user_id !== user.id ? [audit(c.env.DB, user.id, "delete", "message", c.req.param("id"))] : []),
    ]);
    return c.json(await detail(c.env.DB, m.ride_id));
  });
