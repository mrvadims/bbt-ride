// GET /api/routes?q= (library search, editors; the scheduled job fills the library) and GET /api/routes/:id (one route).
// Only editors can look up a route the app hasn't seen: each lookup spends the captain's RideWithGPS credentials.
import { Hono } from "hono";
import type { RouteSummary } from "../../shared/api.ts";
import type { Route } from "../../shared/ride.ts";
import { type AppEnv, can, requireRole } from "../app.ts";
import { getRoute } from "../rwgps.ts";
import { fail } from "../util.ts";

export const routes = new Hono<AppEnv>()
  .get("/", requireRole("edit"), async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    const { results } = await c.env.DB.prepare(
      "select json from route_cache where in_library = 1 and json is not null and name like ? order by name limit 50", // LIKE ignores ASCII case
    )
      .bind(`%${q.replace(/[%_]/g, "")}%`)
      .all<{ json: string }>();
    return c.json<RouteSummary[]>(
      results.map(({ json }) => {
        const r = JSON.parse(json) as Route;
        const first = r.track[0] ?? [0, 0];
        return {
          id: r.id,
          name: r.name,
          distance_m: r.distance_m,
          elevation_gain_m: r.elevation_gain_m,
          start: [first[0], first[1]],
        };
      }),
    );
  })
  .get("/:id{[0-9]+}", async (c) => {
    const id = Number(c.req.param("id"));
    if (!can(c.get("user"), "edit")) {
      const known = await c.env.DB.prepare("select 1 from route_cache where rwgps_route_id = ? and json is not null")
        .bind(id)
        .first();
      if (!known) return fail(404, "Route not found");
    }
    const route = await getRoute(c.env, id);
    return route ? c.json(route) : fail(404, "Route not found on RideWithGPS (it may be private)");
  });
