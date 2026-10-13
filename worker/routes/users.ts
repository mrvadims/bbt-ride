// Account and team management: /api/me (everyone), users and invites (Admin), invite and reset links (public).
import { Hono } from "hono";
import {
  type Invite,
  inviteInput,
  linkAccept,
  linkToken,
  type Me,
  mutedInput,
  type Role,
  type UserRow,
  userEdit,
} from "../../shared/api.ts";
import type { Sport } from "../../shared/sports.ts";
import { type AppEnv, requireRole, type SessionUser } from "../app.ts";
import { audit, fail, nowIso, randomToken, sha256Hex } from "../util.ts";
import { validate } from "../validate.ts";
import { calendarUrl as calendarLinkOf, resetCalendarLink } from "./calendar.ts";

const INVITE_DAYS = 7;
const RESET_HOURS = 24;

/** Sign-in methods per user: one user's, or everyone's (D1 binds at most 100 variables, so no IN list). */
async function methodsOf(db: D1Database, userId?: string): Promise<Map<string, ("google" | "password")[]>> {
  const q = `select "userId" as user_id, "providerId" as provider from account`;
  const { results } = await (userId ? db.prepare(`${q} where "userId" = ?`).bind(userId) : db.prepare(q)).all<{
    user_id: string;
    provider: string;
  }>();
  const out = new Map<string, ("google" | "password")[]>();
  for (const r of results)
    out.set(r.user_id, [...(out.get(r.user_id) ?? []), r.provider === "google" ? "google" : "password"]);
  return out;
}

/** Creates an invite or reset link; returns the full URL (shown once to the Admin, who sends it). */
async function createLink(
  env: Env,
  kind: "invite" | "reset",
  email: string,
  role: Role | null,
  userId: string | null,
  by: string,
) {
  const token = randomToken();
  const ms = kind === "invite" ? INVITE_DAYS * 24 * 3600e3 : RESET_HOURS * 3600e3;
  await env.DB.batch([
    // A new link replaces any open one for the same person.
    env.DB.prepare("update links set used_at = ? where kind = ? and email = ? and used_at is null").bind(
      nowIso(),
      kind,
      email,
    ),
    env.DB.prepare(
      "insert into links (token_hash, kind, email, role, user_id, created_by, created_at, expires_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(await sha256Hex(token), kind, email, role, userId, by, nowIso(), new Date(Date.now() + ms).toISOString()),
    audit(env.DB, by, `create-${kind}-link`, "user", userId ?? email),
  ]);
  return `${env.BETTER_AUTH_URL}/${kind}/${token}`;
}

async function openLink(db: D1Database, token: string) {
  return db
    .prepare(
      "select token_hash, kind, email, user_id from links where token_hash = ? and used_at is null and expires_at > ?",
    )
    .bind(await sha256Hex(token), nowIso())
    .first<{ token_hash: string; kind: "invite" | "reset"; email: string; user_id: string | null }>();
}

async function meOf(env: Env, u: SessionUser): Promise<Me> {
  const [methods, muted, calendarUrl] = await Promise.all([
    methodsOf(env.DB, u.id),
    env.DB.prepare("select sport from notify_off where user_id = ?").bind(u.id).all<{ sport: Sport }>(),
    calendarLinkOf(env, u.id),
  ]);
  return {
    ...u,
    methods: methods.get(u.id) ?? [],
    vapidPublicKey: env.VAPID_PUBLIC_KEY,
    mutedSports: muted.results.map((r) => r.sport),
    calendarUrl,
  };
}

// The signed-in person: their account, the sports they muted for new posts, and their calendar link.
export const me = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await meOf(c.env, c.get("user"))))
  .put("/muted", validate("json", mutedInput), async (c) => {
    const id = c.get("user").id;
    await c.env.DB.batch([
      c.env.DB.prepare("delete from notify_off where user_id = ?").bind(id),
      ...c.req
        .valid("json")
        .sports.map((s) => c.env.DB.prepare("insert into notify_off (user_id, sport) values (?, ?)").bind(id, s)),
    ]);
    return c.json(await meOf(c.env, c.get("user")));
  })
  .post("/calendar", async (c) => {
    await resetCalendarLink(c.env, c.get("user").id);
    return c.json(await meOf(c.env, c.get("user")));
  });

export const users = new Hono<AppEnv>()
  .use(requireRole("admin"))
  .get("/", async (c) => {
    const [{ results: rows }, { results: invites }] = await Promise.all([
      c.env.DB.prepare(`select id, name, email, username, role, banned from "user" order by name`).all<{
        id: string;
        name: string;
        email: string;
        username: string | null;
        role: Role | null;
        banned: number | null;
      }>(),
      c.env.DB.prepare(
        "select email, role, expires_at from links where kind = 'invite' and used_at is null and expires_at > ? order by created_at",
      )
        .bind(nowIso())
        .all<{ email: string; role: Role; expires_at: string }>(),
    ]);
    const methods = await methodsOf(c.env.DB);
    return c.json({
      users: rows.map(
        (r): UserRow => ({
          ...r,
          role: r.role ?? "view",
          disabled: Boolean(r.banned),
          methods: methods.get(r.id) ?? [],
        }),
      ),
      invites: invites.map((i): Invite => ({ email: i.email, role: i.role, expiresAt: i.expires_at })),
    });
  })
  .post("/invites", validate("json", inviteInput), async (c) => {
    const { email, role } = c.req.valid("json");
    const taken = await c.env.DB.prepare(`select 1 from "user" where email = ?`).bind(email).first();
    if (taken) fail(409, "That email already has an account");
    return c.json({ url: await createLink(c.env, "invite", email, role, null, c.get("user").id) }, 201);
  })
  .delete("/invites/:email", async (c) => {
    await c.env.DB.prepare("update links set used_at = ? where kind = 'invite' and email = ? and used_at is null")
      .bind(nowIso(), c.req.param("email").toLowerCase())
      .run();
    return c.body(null, 204);
  })
  .post("/:id/reset-link", async (c) => {
    const u = await c.env.DB.prepare(`select id, email from "user" where id = ?`)
      .bind(c.req.param("id"))
      .first<{ id: string; email: string }>();
    if (!u) return fail(404, "User not found");
    return c.json({ url: await createLink(c.env, "reset", u.email, null, u.id, c.get("user").id) }, 201);
  })
  .patch("/:id", validate("json", userEdit), async (c) => {
    const id = c.req.param("id");
    const me = c.get("user");
    const e = c.req.valid("json");
    if (id === me.id && ((e.role && e.role !== "admin") || e.disabled))
      fail(400, "You can't remove your own Admin access");
    const auth = c.get("auth");
    const headers = c.req.raw.headers;
    if (e.role) await auth.api.setRole({ body: { userId: id, role: e.role }, headers });
    if (e.disabled === true) await auth.api.banUser({ body: { userId: id }, headers }); // also ends their sessions
    if (e.disabled === false) await auth.api.unbanUser({ body: { userId: id }, headers });
    await audit(c.env.DB, me.id, "update", "user", id, e).run();
    return c.body(null, 204);
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (id === c.get("user").id) fail(400, "You can't delete your own account");
    const u = await c.env.DB.prepare(`select email from "user" where id = ?`).bind(id).first<{ email: string }>();
    if (!u) return fail(404, "User not found");
    await c.get("auth").api.removeUser({ body: { userId: id }, headers: c.req.raw.headers });
    // The email also sits in old links and in the audit trail of invites; the privacy page promises it goes too.
    await c.env.DB.batch([
      c.env.DB.prepare("delete from links where email = ?").bind(u.email),
      c.env.DB.prepare("update audit_log set entity_id = ? where entity_id = ?").bind(id, u.email),
      audit(c.env.DB, c.get("user").id, "delete", "user", id),
    ]);
    return c.body(null, 204);
  });

// Public: the invite and reset pages read their link, then set a password (and create the account for invites).
// The person then signs in on the sign-in page, so each request hashes the password once (Workers CPU limit).
const EXPIRED = "This link has expired or was already used. Ask a team admin for a new one.";
export const links = new Hono<AppEnv>()
  .post("/", validate("json", linkToken), async (c) => {
    const link = await openLink(c.env.DB, c.req.valid("json").token);
    return link ? c.json({ kind: link.kind, email: link.email }) : fail(404, EXPIRED);
  })
  .post("/accept", validate("json", linkAccept), async (c) => {
    const { token, name, username, password } = c.req.valid("json");
    const link = await openLink(c.env.DB, token);
    if (!link) return fail(404, EXPIRED);
    const ctx = await c.get("auth").$context;
    const hash = await ctx.password.hash(password);
    if (link.kind === "invite") {
      if (!name) fail(400, "Add your name");
      if (username) {
        const taken = await c.env.DB.prepare(`select 1 from "user" where username = ?`).bind(username).first();
        if (taken) fail(409, "That username is taken");
      }
      // The create hook (worker/auth.ts) checks the invite, sets the role and marks the invite used.
      const user = await ctx.internalAdapter.createUser(
        { email: link.email, name: name as string, ...(username && { username, displayUsername: username }) },
        { method: "email-password" },
      );
      await ctx.internalAdapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: hash,
      });
    } else {
      // Claim the reset link atomically, so it can't be used twice at once.
      const claim = await c.env.DB.prepare("update links set used_at = ? where token_hash = ? and used_at is null")
        .bind(nowIso(), link.token_hash)
        .run();
      if (claim.meta.changes !== 1) return fail(404, "This link was already used.");
      const userId = link.user_id as string;
      if (await ctx.internalAdapter.findCredentialAccount(userId))
        await ctx.internalAdapter.updatePassword(userId, hash);
      else
        await ctx.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: hash });
      await ctx.internalAdapter.deleteUserSessions(userId); // sign out everywhere else
    }
    return c.body(null, 204);
  });
