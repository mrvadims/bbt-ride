// Better Auth in the Worker (DESIGN.md → Users and roles). Built per request because bindings come from `env`.
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { authPlugins, RATE_LIMIT, type Role } from "./auth-plugins.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import { nowIso } from "./util.ts";

const DAY = 24 * 60 * 60;
const NOT_INVITED = "Not invited — ask a team admin";
const RESERVED_NAMES = /^(ride update|former member)$/i; // labels the app uses for system posts

/** Display names are shown to the whole team: 1–80 characters and not a system label. */
function checkName(name: unknown): string | undefined {
  if (name === undefined) return undefined;
  const n = String(name).trim().replace(/\s+/g, " ");
  if (!n || n.length > 80 || RESERVED_NAMES.test(n))
    throw new APIError("BAD_REQUEST", { message: "Use a name of 1–80 characters." });
  return n;
}

/** The role a new account gets: from an open invite for its email, or Admin for the bootstrap email. */
async function invitedRole(env: Env, email: string): Promise<Role | null> {
  const invite = await env.DB.prepare(
    "select role from links where kind = 'invite' and email = ? and used_at is null and expires_at > ? order by created_at desc limit 1",
  )
    .bind(email, nowIso())
    .first<{ role: Role }>();
  if (invite) return invite.role;
  if (email === env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) {
    const anyAdmin = await env.DB.prepare(`select 1 from "user" where role = 'admin' limit 1`).first();
    if (!anyAdmin) return "admin";
  }
  return null;
}

// Google's tokens aren't needed after sign-in, so they are never stored.
const withoutTokens = async <T extends Record<string, unknown>>(account: T) => ({
  data: { ...account, accessToken: null, refreshToken: null, idToken: null },
});

export function createAuth(env: Env) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.SESSION_SECRET,
    database: env.DB,
    trustedOrigins: [env.BETTER_AUTH_URL],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // password accounts are created only through invite links (worker/routes/links.ts)
      minPasswordLength: 10,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    socialProviders: {
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: "select_account" },
    },
    session: { expiresIn: 30 * DAY, updateAge: DAY }, // no cookie cache: role changes apply on the next request
    rateLimit: RATE_LIMIT,
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    onAPIError: { errorURL: "/signin" },
    plugins: authPlugins(),
    databaseHooks: {
      user: {
        create: {
          // Only invited emails (or the bootstrap Admin) may get an account; no profile photo is kept.
          before: async (user) => {
            const email = user.email.toLowerCase();
            const role = await invitedRole(env, email);
            if (!role) throw new APIError("FORBIDDEN", { message: NOT_INVITED });
            // Google supplies the name, so tidy it rather than refuse the sign-in.
            let name = String(user.name ?? "")
              .trim()
              .replace(/\s+/g, " ")
              .slice(0, 80);
            if (!name || RESERVED_NAMES.test(name)) name = email.split("@")[0] ?? "Rider";
            return { data: { ...user, name, email, role, image: null, emailVerified: true } };
          },
          after: async (user) => {
            await env.DB.prepare("update links set used_at = ? where kind = 'invite' and email = ? and used_at is null")
              .bind(nowIso(), user.email)
              .run();
          },
        },
        update: {
          before: async (user) => {
            const name = checkName(user.name);
            return { data: { ...user, ...(name !== undefined && { name }), image: null } };
          },
        },
      },
      account: { create: { before: withoutTokens }, update: { before: withoutTokens } },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
