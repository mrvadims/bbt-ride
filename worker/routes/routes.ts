// GET /api/routes?q= (library search; the scheduled job fills the library) and GET /api/routes/:id (one route).
import { Hono } from "hono";
import type { RouteSummary } from "../../shared/api.ts";
import type { Route } from "../../shared/ride.ts";
import type { AppEnv } from "../app.ts";
import { getRoute } from "../rwgps.ts";
import { fail } from "../util.ts";

export const routes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    const { results } = await c.env.DB.prepare(
      "select json from route_cache where in_library = 1 and json is not null and lower(name) like ? order by name limit 50",
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
    const route = await getRoute(c.env, Number(c.req.param("id")));
    return route ? c.json(route) : fail(404, "Route not found on RideWithGPS (it may be private)");
  });
