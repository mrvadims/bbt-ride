// Worker entry: /api/auth/* (Better Auth) and /api/* (the app's JSON API). Everything else is static assets.

import { APIError } from "better-auth/api";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { type AppEnv, requireSession, sameOrigin, withAuth } from "./app.ts";
import { scheduled } from "./cron.ts";
import { deliver, type PushJob, push } from "./push.ts";
import { activities, messages } from "./routes/activities.ts";
import { calendar } from "./routes/calendar.ts";
import { drafts } from "./routes/drafts.ts";
import { routes } from "./routes/routes.ts";
import { settings } from "./routes/settings.ts";
import { spots } from "./routes/spots.ts";
import { links, me, team, users } from "./routes/users.ts";
import { weather } from "./routes/weather.ts";

const app = new Hono<AppEnv>().basePath("/api");

// Read any request body a handler (or an early rejection) left unread before replying: a half-read body can leave the
// connection unusable for the next request.
app.use(async (c, next) => {
  await next();
  if (c.req.raw.body && !c.req.raw.bodyUsed) await c.req.raw.arrayBuffer().catch(() => undefined);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof APIError) return c.json({ error: err.message }, err.statusCode as 400);
  if (String(err).includes("UNIQUE constraint failed"))
    return c.json({ error: "That was just taken by someone else. Reload and try again." }, 409);
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});
app.notFound((c) => c.json({ error: "Not found" }, 404));

app.use(secureHeaders()); // nosniff, frame and referrer protections on API responses
// No request the app makes comes near this; larger bodies are refused before anything parses them.
app.use(bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) }));

// Public, read-only and without Better Auth (it costs CPU on every request that builds it)
app.get("/health", (c) => c.json({ ok: true }));
app.route("/cal", calendar); // calendar apps fetch the private feed without a session

app.use(withAuth);
// Better Auth's admin endpoints (impersonation, setting passwords, …) aren't used by the app, which calls the ones it needs
// on the server from /api/users with its own checks and audit log; keep them unreachable from browsers.
app.all("/auth/admin/*", (c) => c.json({ error: "Not found" }, 404));
app.on(["GET", "POST"], "/auth/*", (c) => c.get("auth").handler(c.req.raw)); // Better Auth checks its own origins
app.use(sameOrigin);

// Public: the invite and reset pages
app.route("/links", links);

// Signed in
app.use(requireSession);
app.route("/me", me);
app.route("/team", team);
app.route("/weather", weather);
app.route("/routes", routes);
app.route("/spots", spots);
app.route("/settings", settings);
app.route("/activities", activities);
app.route("/messages", messages);
app.route("/push", push);
app.route("/draft", drafts);
app.route("/users", users);

export default {
  fetch: app.fetch,
  scheduled: async (_controller, env, ctx) => ctx.waitUntil(scheduled(env)),
  queue: deliver,
} satisfies ExportedHandler<Env, PushJob>;
