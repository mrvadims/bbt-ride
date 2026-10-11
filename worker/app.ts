// Hono app type, session and role middleware (DESIGN.md → Server-side checks).
import { createMiddleware } from "hono/factory";
import type { Role } from "../shared/api.ts";
import { type Auth, createAuth } from "./auth.ts";
import { fail } from "./util.ts";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: Role;
}

export type AppEnv = { Bindings: Env; Variables: { auth: Auth; user: SessionUser } };

const RANK: Record<Role, number> = { view: 0, edit: 1, admin: 2 };

// One Better Auth instance per isolate and environment.
const instances = new WeakMap<Env, Auth>();
export const withAuth = createMiddleware<AppEnv>(async (c, next) => {
  let auth = instances.get(c.env);
  if (!auth) {
    auth = createAuth(c.env);
    instances.set(c.env, auth);
  }
  c.set("auth", auth);
  await next();
});

/** Data-changing requests must come from the app itself (CSRF protection on top of SameSite cookies). */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    if (c.req.header("origin") !== new URL(c.env.BETTER_AUTH_URL).origin) fail(403, "Cross-origin request refused");
  }
  await next();
});

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
  if (!session) return fail(401, "Sign in first");
  const u = session.user as typeof session.user & { role?: string | null; username?: string | null };
  const role: Role = u.role === "admin" || u.role === "edit" ? u.role : "view";
  c.set("user", { id: u.id, name: u.name, email: u.email, username: u.username ?? null, role });
  await next();
});

export const requireRole = (min: Role) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (RANK[c.get("user").role] < RANK[min]) fail(403, min === "admin" ? "Admins only" : "Editors only");
    await next();
  });

export const can = (user: SessionUser, min: Role): boolean => RANK[user.role] >= RANK[min];
