// LOCAL development only: loads the saved Open-Meteo sample (data/raw/om_purchase.json, Oct 7–11 2026) into the local
// KV cache for every spot, and the four sample routes into the local route cache, so the app works without network.
// Run after `npm run db:migrate:local`: node scripts/dev-seed.ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simplify } from "../worker/rwgps.ts";

const wrangler = (...args: string[]) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8" });
const d1 = (sql: string) =>
  JSON.parse(wrangler("d1", "execute", "DB", "--local", "--json", "--command", sql))[0].results as Record<
    string,
    unknown
  >[];

// Same key as worker/routes/weather.ts: active spots ordered by name.
const spots = d1("select id, lat, lng from spots where archived = 0 order by name") as {
  id: string;
  lat: number;
  lng: number;
}[];
const key = createHash("sha256")
  .update(spots.map((s) => `${s.id}:${s.lat}:${s.lng}`).join("|"))
  .digest("hex");
const sample = JSON.parse(readFileSync(join(import.meta.dirname, "..", "data/raw/om_purchase.json"), "utf8"));
const put = (name: string, value: unknown) => {
  const file = join(tmpdir(), `bbt-${name.replace(/\W/g, "_")}.json`);
  writeFileSync(file, JSON.stringify(value));
  wrangler("kv", "key", "put", name, "--path", file, "--binding", "CACHE", "--local");
};
// worker/routes/weather.ts cache format: { at, value }; a far-future `at` keeps the sample "fresh".
const far = Date.now() + 10 * 365 * 864e5;
put(`forecast:${key}`, { at: far, value: { fetchedAt: new Date().toISOString(), data: spots.map(() => sample) } });
put(`alerts:${key}`, { at: far, value: spots.map(() => []) });

for (const id of [57406828, 57426135, 57215407, 37475253]) {
  const route = simplify(
    JSON.parse(readFileSync(join(import.meta.dirname, "..", `data/raw/route_${id}.json`), "utf8")),
  );
  const json = JSON.stringify(route).replaceAll("'", "''");
  d1(
    `insert into route_cache (rwgps_route_id, name, json, in_library, fetched_at) values (${id}, '${route.name.replaceAll("'", "''")}', '${json}', 1, '${new Date().toISOString()}')
     on conflict (rwgps_route_id) do update set name = excluded.name, json = excluded.json, fetched_at = excluded.fetched_at`,
  );
}
console.log(`Seeded the sample forecast for ${spots.length} spots and 4 routes into the local KV and D1.`);
