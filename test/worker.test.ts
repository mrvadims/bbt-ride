import { describe, expect, it } from "vitest";
import raw from "../data/raw/route_57406828.json";
import seed from "../data/seed.json";
import { hashPassword, verifyPassword } from "../worker/password.ts";
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
