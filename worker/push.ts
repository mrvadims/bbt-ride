// Web Push for activity updates, cancellations and restores (DESIGN.md → Notifications), delivered through a Queue.
import { buildPushPayload } from "@block65/webcrypto-web-push";
import { Hono } from "hono";
import { pushSubscription } from "../shared/api.ts";
import type { AppEnv } from "./app.ts";
import { nowIso } from "./util.ts";
import { validate } from "./validate.ts";

interface Sub {
  endpoint: string;
  keys_json: string;
}
/** One queue message: a notification and up to BATCH devices to send it to. */
export interface PushJob {
  data: string;
  subs: Sub[];
}
// Each queue delivery runs in its own invocation. Encrypting and signing a message takes about 1–2 ms of CPU per device,
// so a small batch keeps each run inside the free plan's ~10 ms CPU (and far under 50 outbound requests).
const BATCH = 5;

/** Queues a notification about an activity for every opted-in device (disabled members excluded); delivery runs in
 * `deliver`. Tapping it opens the activity. */
export async function notifyActivity(env: Env, id: string, title: string, body: string): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return; // push not configured (local development)
  const { results } = await env.DB.prepare(
    `select p.endpoint, p.keys_json from push_subscriptions p join "user" u on u.id = p.user_id where coalesce(u.banned, 0) = 0`,
  ).all<Sub>();
  const data = JSON.stringify({ title, body, url: `/a/${id}` });
  const jobs: { body: PushJob }[] = [];
  for (let i = 0; i < results.length; i += BATCH) jobs.push({ body: { data, subs: results.slice(i, i + BATCH) } });
  if (jobs.length) await env.PUSH.sendBatch(jobs);
}

/** Queue consumer: sends one batch. A device the push service reports gone (404/410) is forgotten. */
export async function deliver(batch: MessageBatch<PushJob>, env: Env): Promise<void> {
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  for (const msg of batch.messages) {
    const { data, subs } = msg.body;
    await Promise.all(
      subs.map(async (s) => {
        try {
          const sub = { endpoint: s.endpoint, expirationTime: null, keys: JSON.parse(s.keys_json) };
          const payload = await buildPushPayload({ data, options: { ttl: 24 * 60 * 60, urgency: "high" } }, sub, vapid);
          const res = await fetch(s.endpoint, payload);
          await res.body?.cancel();
          if (res.status === 404 || res.status === 410)
            await env.DB.prepare("delete from push_subscriptions where endpoint = ?").bind(s.endpoint).run();
        } catch (err) {
          console.error("push failed", err); // one bad device mustn't stop the others, or resend to them
        }
      }),
    );
    msg.ack();
  }
}

// The account menu's "Notifications" switch: one subscription per device, owned by whoever last turned it on there.
export const push = new Hono<AppEnv>()
  .post("/", validate("json", pushSubscription), async (c) => {
    const { endpoint, keys } = c.req.valid("json");
    await c.env.DB.prepare(
      "insert into push_subscriptions (endpoint, user_id, keys_json, created_at) values (?, ?, ?, ?) on conflict (endpoint) do update set user_id = excluded.user_id, keys_json = excluded.keys_json",
    )
      .bind(endpoint, c.get("user").id, JSON.stringify(keys), nowIso())
      .run();
    return c.body(null, 204);
  })
  .delete("/", validate("json", pushSubscription.pick({ endpoint: true })), async (c) => {
    await c.env.DB.prepare("delete from push_subscriptions where endpoint = ? and user_id = ?")
      .bind(c.req.valid("json").endpoint, c.get("user").id)
      .run();
    return c.body(null, 204);
  });
