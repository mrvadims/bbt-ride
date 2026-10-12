// Web Push for ride updates, cancellations and restores (DESIGN.md → Notifications). Runs in the background (waitUntil).
import { buildPushPayload } from "@block65/webcrypto-web-push";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { pushSubscription } from "../shared/api.ts";
import type { AppEnv } from "./app.ts";
import { nowIso } from "./util.ts";

export async function notifyRide(env: Env, rideId: string, title: string, body: string): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return; // push not configured (local development)
  const ride = await env.DB.prepare("select date from rides where id = ?").bind(rideId).first<{ date: string }>();
  // Disabled members get nothing (their subscriptions stay, in case they are enabled again).
  const { results } = await env.DB.prepare(
    `select p.endpoint, p.keys_json from push_subscriptions p join "user" u on u.id = p.user_id where coalesce(u.banned, 0) = 0`,
  ).all<{
    endpoint: string;
    keys_json: string;
  }>();
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const data = JSON.stringify({ title, body, url: ride ? `/ride/${ride.date}` : "/" });
  await Promise.all(
    results.map(async (s) => {
      const sub = {
        endpoint: s.endpoint,
        expirationTime: null,
        keys: JSON.parse(s.keys_json) as { p256dh: string; auth: string },
      };
      try {
        const payload = await buildPushPayload({ data, options: { ttl: 24 * 60 * 60, urgency: "high" } }, sub, vapid);
        const res = await fetch(s.endpoint, payload);
        await res.body?.cancel();
        // The push service says this device is gone: forget it.
        if (res.status === 404 || res.status === 410)
          await env.DB.prepare("delete from push_subscriptions where endpoint = ?").bind(s.endpoint).run();
      } catch (err) {
        console.error("push failed", err); // one bad subscription mustn't stop the others
      }
    }),
  );
}

// The account menu's "Ride notifications" switch: one subscription per device, owned by whoever last turned it on there.
export const push = new Hono<AppEnv>()
  .post("/", zValidator("json", pushSubscription), async (c) => {
    const { endpoint, keys } = c.req.valid("json");
    await c.env.DB.prepare(
      "insert into push_subscriptions (endpoint, user_id, keys_json, created_at) values (?, ?, ?, ?) on conflict (endpoint) do update set user_id = excluded.user_id, keys_json = excluded.keys_json",
    )
      .bind(endpoint, c.get("user").id, JSON.stringify(keys), nowIso())
      .run();
    return c.body(null, 204);
  })
  .delete("/", zValidator("json", pushSubscription.pick({ endpoint: true })), async (c) => {
    await c.env.DB.prepare("delete from push_subscriptions where endpoint = ? and user_id = ?")
      .bind(c.req.valid("json").endpoint, c.get("user").id)
      .run();
    return c.body(null, 204);
  });
