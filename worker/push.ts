// Notifications for new activities, updates, cancellations and restores (DESIGN.md → Notifications, v2), delivered
// through a Queue: Web Push to browsers and the iPhone Home Screen app, Firebase to the Android app (worker/fcm.ts).
import { buildPushPayload } from "@block65/webcrypto-web-push";
import { Hono } from "hono";
import { z } from "zod";
import { appPushToken, pushSubscription } from "../shared/api.ts";
import type { Sport } from "../shared/sports.ts";
import type { AppEnv } from "./app.ts";
import { type FcmAuth, fcmAuth, sendFcm } from "./fcm.ts";
import { nowIso } from "./util.ts";
import { validate } from "./validate.ts";

interface Sub {
  endpoint: string; // Web Push URL, or the app's Firebase token
  keys_json: string;
  kind?: "web" | "fcm"; // missing on jobs queued before the app existed
}
/** One queue message: a notification and up to BATCH devices to send it to. */
export interface PushJob {
  data: string;
  subs: Sub[];
  retry?: boolean; // a second try for devices whose push service failed for a moment
}
// Each queue delivery runs in its own invocation. Encrypting and signing a Web Push message takes about 1–2 ms of CPU per
// device, so a small batch keeps each run inside the free plan's ~10 ms CPU (and far under 50 outbound requests). A
// Firebase message costs no crypto, apart from signing the hourly token.
const BATCH = 5;

/** Queues a notification about an activity for every opted-in device of members who aren't disabled; delivery runs in
 * `deliver`. Tapping it opens the activity.
 * - `newPost`: a new activity of that sport, sent only to people who didn't mute the sport, and not to its author.
 * - `answer`: people who are in get Still in / I'm out buttons (Android; other platforms just open the activity).
 * - `to`: only these people (a mention, or those going to a deleted activity), whatever sports they muted.
 * - `url`: where tapping it goes, when the activity itself is gone. */
export async function notifyActivity(
  env: Env,
  id: string,
  title: string,
  body: string,
  opts: { newPost?: { sport: Sport; author: string }; answer?: boolean; to?: string[]; url?: string } = {},
): Promise<void> {
  const web = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  const app = Boolean(env.FCM_SERVICE_ACCOUNT);
  if (!web && !app) return; // push not configured (local development)
  if (opts.to?.length === 0) return;
  const post = opts.newPost;
  const { results } = await env.DB.prepare(
    `select p.endpoint, p.keys_json, p.kind,
            exists (select 1 from rsvps v where v.activity_id = ?1 and v.user_id = p.user_id and v.status = 'in') as is_in
     from push_subscriptions p join "user" u on u.id = p.user_id
     where coalesce(u.banned, 0) = 0 and (p.kind = 'web' and ?4 or p.kind = 'fcm' and ?5)
       and (?2 is null or (p.user_id != ?3
            and not exists (select 1 from notify_off n where n.user_id = p.user_id and n.sport = ?2)))
       and (?6 is null or p.user_id in (select value from json_each(?6)))`,
  )
    .bind(
      id,
      post?.sport ?? null,
      post?.author ?? "",
      web ? 1 : 0,
      app ? 1 : 0,
      opts.to ? JSON.stringify(opts.to) : null,
    )
    .all<Sub & { is_in: number }>();
  const message = (actions: boolean) =>
    JSON.stringify({
      title,
      body,
      url: opts.url ?? `/a/${id}`,
      ...(actions
        ? {
            activityId: id,
            actions: [
              { action: "in", title: "Still in" },
              { action: "out", title: "I'm out" },
            ],
          }
        : {}),
    });
  const jobs: { body: PushJob }[] = [];
  for (const isIn of [true, false]) {
    const subs = results
      .filter((r) => Boolean(r.is_in) === isIn)
      .map(({ endpoint, keys_json, kind }) => ({ endpoint, keys_json, kind }));
    const data = message(isIn && Boolean(opts.answer));
    for (let i = 0; i < subs.length; i += BATCH) jobs.push({ body: { data, subs: subs.slice(i, i + BATCH) } });
  }
  if (jobs.length) await env.PUSH.sendBatch(jobs);
}

/** Queue consumer: sends one batch. A device the push service reports gone (404/410, or an old app token) is
 * forgotten. A device that fails for another reason (network, rate limit, a push service error) is logged and tried
 * once more a minute later, on its own, so the others don't get the notification twice. */
export async function deliver(batch: MessageBatch<PushJob>, env: Env): Promise<void> {
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  let auth: Promise<FcmAuth | null> | undefined; // signed once, only if the batch has an app device
  const forget = (endpoint: string) =>
    env.DB.prepare("delete from push_subscriptions where endpoint = ?").bind(endpoint).run();
  for (const msg of batch.messages) {
    const { data, subs, retry } = msg.body;
    const failed: Sub[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          if (s.kind === "fcm") {
            auth ??= fcmAuth(env);
            const a = await auth;
            if (a && (await sendFcm(env, a, s.endpoint, data)) === "gone") await forget(s.endpoint);
            return;
          }
          const sub = { endpoint: s.endpoint, expirationTime: null, keys: JSON.parse(s.keys_json) };
          const payload = await buildPushPayload({ data, options: { ttl: 24 * 60 * 60, urgency: "high" } }, sub, vapid);
          const res = await fetch(s.endpoint, payload);
          if (res.ok) await res.body?.cancel();
          else if (res.status === 404 || res.status === 410) {
            await res.body?.cancel();
            await forget(s.endpoint);
          } else
            throw new Error(
              `Web Push ${res.status} from ${new URL(s.endpoint).host}: ${(await res.text()).slice(0, 200)}`,
            );
        } catch (err) {
          console.error(retry ? "push failed again" : "push failed", String(err)); // one bad device mustn't stop the others
          failed.push(s);
        }
      }),
    );
    if (failed.length && !retry) await env.PUSH.send({ data, subs: failed, retry: true }, { delaySeconds: 60 });
    msg.ack();
  }
}

// The account menu's "Notifications" switch: one subscription per device, owned by whoever last turned it on there.
// Registering again refreshes created_at; a person keeps their newest MAX_DEVICES devices.
const MAX_DEVICES = 10;
const save = (env: Env, endpoint: string, userId: string, keys: string, kind: "web" | "fcm") =>
  env.DB.batch([
    env.DB.prepare(
      `insert into push_subscriptions (endpoint, user_id, keys_json, kind, created_at) values (?, ?, ?, ?, ?)
       on conflict (endpoint) do update set user_id = excluded.user_id, keys_json = excluded.keys_json,
         kind = excluded.kind, created_at = excluded.created_at`,
    ).bind(endpoint, userId, keys, kind, nowIso()),
    env.DB.prepare(
      `delete from push_subscriptions where user_id = ?1 and endpoint not in
         (select endpoint from push_subscriptions where user_id = ?1 order by created_at desc limit ${MAX_DEVICES})`,
    ).bind(userId),
  ]);
export const push = new Hono<AppEnv>()
  .post("/", validate("json", pushSubscription), async (c) => {
    const { endpoint, keys } = c.req.valid("json");
    await save(c.env, endpoint, c.get("user").id, JSON.stringify(keys), "web");
    return c.body(null, 204);
  })
  // The Android app's Firebase token (src/lib/native.ts), registered again each time the app starts.
  .post("/app", validate("json", appPushToken), async (c) => {
    await save(c.env, c.req.valid("json").token, c.get("user").id, "{}", "fcm");
    return c.body(null, 204);
  })
  .delete("/", validate("json", z.object({ endpoint: z.string().min(1).max(4096) })), async (c) => {
    await c.env.DB.prepare("delete from push_subscriptions where endpoint = ? and user_id = ?")
      .bind(c.req.valid("json").endpoint, c.get("user").id)
      .run();
    return c.body(null, 204);
  });
