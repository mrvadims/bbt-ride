import { describe, expect, it } from "vitest";
import raw from "../data/raw/route_57406828.json";
import seed from "../data/seed.json";
import { pushSubscription } from "../shared/api.ts";
import { hashPassword, verifyPassword } from "../worker/password.ts";
import { perSpot } from "../worker/routes/weather.ts";
import { simplify } from "../worker/rwgps.ts";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^pbkdf2\$100000\$/);
    expect(await verifyPassword({ hash, password: "correct horse battery" })).toBe(true);
    expect(await verifyPassword({ hash, password: "correct horse batterY" })).toBe(false);
    expect(await verifyPassword({ hash: "garbage", password: "x" })).toBe(false);
  });
  it("salts each hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});

describe("RideWithGPS route simplification", () => {
  const route = simplify(raw as unknown as Parameters<typeof simplify>[0]);
  const ref = seed.routes.find((r) => r.id === 57406828);
  it("keeps at most 350 points and the route's start and end", () => {
    expect(route.track.length).toBeLessThanOrEqual(351);
    expect(route.track[0]?.slice(0, 2)).toEqual([41.04685, -73.6971]);
    expect(route.distance_m).toBe(ref?.distance_m);
  });
  it("places POIs along the route like the seed data", () => {
    const tazza = route.pois.find((p) => p.name === "Tazza Cafe");
    expect(tazza?.type).toBe("coffee");
    expect(Math.abs((tazza?.route_d_m ?? 0) - (ref?.pois[0]?.route_d_m ?? 0))).toBeLessThan(50);
    expect(tazza?.off_route_m).toBeLessThan(50);
  });
});

describe("Web Push payload", () => {
  const b64url = (b: ArrayBuffer | Uint8Array) =>
    Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");
  it("builds an encrypted, VAPID-signed request from keys in web-push's format", async () => {
    const { buildPushPayload } = await import("@block65/webcrypto-web-push");
    // VAPID key pair as `npx web-push generate-vapid-keys` prints it: raw public point and private scalar, base64url.
    const vapid = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
    ])) as CryptoKeyPair;
    const vapidJwk = (await crypto.subtle.exportKey("jwk", vapid.privateKey)) as JsonWebKey;
    const vapidPublic = b64url((await crypto.subtle.exportKey("raw", vapid.publicKey)) as ArrayBuffer);
    // A browser subscription: its own P-256 key and a 16-byte auth secret.
    const client = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const sub = {
      endpoint: "https://push.example.test/abc",
      expirationTime: null,
      keys: {
        p256dh: b64url((await crypto.subtle.exportKey("raw", client.publicKey)) as ArrayBuffer),
        auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
      },
    };
    const payload = await buildPushPayload(
      {
        data: JSON.stringify({ title: "Ride updated", body: "meet 8:30 → 9:00", url: "/ride/2026-10-17" }),
        options: { ttl: 86400, urgency: "high" },
      },
      sub,
      { subject: "mailto:info@bbt.team", publicKey: vapidPublic, privateKey: vapidJwk.d as string },
    );
    expect(payload.method.toUpperCase()).toBe("POST");
    expect(payload.headers.authorization).toMatch(/^vapid t=.+, k=/);
    expect(payload.headers["content-encoding"]).toBe("aes128gcm");
    expect(payload.body.byteLength).toBeGreaterThan(100);
  });
});

describe("per-spot weather cache", () => {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => JSON.parse(store.get(k) ?? "null"),
    put: async (k: string, v: string) => void store.set(k, v),
  } as unknown as KVNamespace;
  const a = { id: "a", lat: 41, lng: -73 };
  const b = { id: "b", lat: 42, lng: -74 };
  const c = { id: "c", lat: 43, lng: -75 };
  const age = (ms: number) => {
    const st = JSON.parse(store.get("forecast") as string) as { tried: number; values: Record<string, { at: number }> };
    st.tried -= ms;
    for (const e of Object.values(st.values)) e.at -= ms;
    store.set("forecast", JSON.stringify(st));
  };
  let tries = 0;
  const down = async (): Promise<string[]> => {
    tries++;
    throw new Error("upstream down");
  };

  it("loads all spots in one call, then serves them from the cache", async () => {
    let calls = 0;
    const load = async (spots: { id: string }[]) => {
      calls++;
      return spots.map((s) => `fresh ${s.id}`);
    };
    const first = await perSpot(kv, "forecast", [a, b], 60_000, load);
    const again = await perSpot(kv, "forecast", [a, b], 60_000, load);
    expect([first.a, first.b, again.a, calls]).toEqual(["fresh a", "fresh b", "fresh a", 1]);
  });
  it("keeps the last good copies when the upstream fails, and leaves out a spot that has none", async () => {
    age(2 * 60_000);
    const out = await perSpot(kv, "forecast", [a, b, c], 60_000, down);
    expect(Object.keys(out).sort()).toEqual(["a", "b"]);
  });
  it("tries an unreachable upstream once per refresh period, not on every request", async () => {
    tries = 0;
    await perSpot(kv, "forecast", [a, b, c], 60_000, down);
    expect(tries).toBe(0);
  });
  it("drops copies older than 6 hours", async () => {
    age(7 * 3600_000);
    expect(await perSpot(kv, "forecast", [a, b], 60_000, down)).toEqual({});
  });
});

describe("push subscriptions", () => {
  const keys = { p256dh: "x", auth: "y" };
  const ok = (endpoint: string) => pushSubscription.safeParse({ endpoint, keys }).success;
  it("accepts the browsers' push services", () => {
    for (const host of [
      "fcm.googleapis.com",
      "jmt17.google.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
    ])
      expect(ok(`https://${host}/send/abc`)).toBe(true);
  });
  it("refuses other hosts, including other Google services, and malformed URLs", () => {
    for (const e of [
      "https://script.google.com/macros/s/x/exec",
      "https://evil.example/x",
      "http://fcm.googleapis.com/x",
      "nope",
    ])
      expect(ok(e)).toBe(false);
  });
});
