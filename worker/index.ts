// Worker entry: /api/auth/* (Better Auth) and /api/* (the app's JSON API). Everything else is static assets.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type AppEnv, requireSession, sameOrigin, withAuth } from "./app.ts";
import { scheduled } from "./cron.ts";
import { push } from "./push.ts";
import { drafts } from "./routes/drafts.ts";
import { messages, rides } from "./routes/rides.ts";
import { routes } from "./routes/routes.ts";
import { settings } from "./routes/settings.ts";
import { spots } from "./routes/spots.ts";
import { links, me, users } from "./routes/users.ts";
import { weather } from "./routes/weather.ts";

const app = new Hono<AppEnv>().basePath("/api");

app.onError(async (err, c) => {
  // Read any unread request body before replying, so a rejected upload doesn't leave the connection half-read.
  if (!c.req.raw.bodyUsed) await c.req.raw.arrayBuffer().catch(() => undefined);
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Something went wrong" }, 500);
});
app.notFound((c) => c.json({ error: "Not found" }, 404));

app.use(withAuth);
app.on(["GET", "POST"], "/auth/*", (c) => c.get("auth").handler(c.req.raw)); // Better Auth checks its own origins
app.use(sameOrigin);

// Public
app.get("/health", (c) => c.json({ ok: true }));
app.route("/links", links);

// Signed in
app.use(requireSession);
app.route("/me", me);
app.route("/weather", weather);
app.route("/routes", routes);
app.route("/spots", spots);
app.route("/settings", settings);
app.route("/rides", rides);
app.route("/messages", messages);
app.route("/push", push);
app.route("/draft", drafts);
app.route("/users", users);

export default {
  fetch: app.fetch,
  scheduled: async (_controller, env, ctx) => ctx.waitUntil(scheduled(env)),
} satisfies ExportedHandler<Env>;
