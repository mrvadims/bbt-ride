// Start spots: list (all), add (Edit), resolve a short Maps link (Edit), edit or archive (Admin).
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { spotEdit, spotInput } from "../../shared/api.ts";
import { mapsLink, parseLatLng, type Spot } from "../../shared/ride.ts";
import { type AppEnv, requireRole } from "../app.ts";
import { audit, fail, newId, nowIso } from "../util.ts";

// A pasted link is kept only if it points at Google Maps; otherwise the spot gets a coordinates link.
const MAPS_HOSTS = /^(www\.)?(google\.[a-z.]+|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl)$/;
function safeMapsUrl(link: string, lat: number, lng: number): string {
  try {
    const u = new URL(link);
    if (u.protocol === "https:" && MAPS_HOSTS.test(u.hostname)) return u.toString();
  } catch {
    // not a URL: plain coordinates
  }
  return mapsLink(lat, lng);
}

type SpotRow = Spot & { archived: number };
const toSpot = ({ archived, ...s }: SpotRow) => ({ ...s, archived: archived === 1 });

export const spots = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(
      "select id, name, lat, lng, maps_url, note, archived from spots order by name",
    ).all<SpotRow>();
    return c.json(results.map(toSpot));
  })
  // Short maps.app.goo.gl links: browsers can't read cross-site redirects, so the Worker follows one hop.
  .post("/resolve", requireRole("edit"), zValidator("json", z.object({ url: z.string().url() })), async (c) => {
    const url = new URL(c.req.valid("json").url);
    if (url.protocol !== "https:" || url.hostname !== "maps.app.goo.gl")
      fail(400, "Only maps.app.goo.gl links need resolving");
    const res = await fetch(url, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    const ll = parseLatLng(decodeURIComponent(location));
    return ll ? c.json({ ...ll, url: url.toString() }) : fail(400, "Couldn't find a pin in that link");
  })
  .post("/", requireRole("edit"), zValidator("json", spotInput), async (c) => {
    const { name, link, note } = c.req.valid("json");
    const ll = parseLatLng(link);
    if (!ll) fail(400, "Paste a Google Maps link with a pin, or coordinates like 41.0454, -73.6973");
    const { lat, lng } = ll as { lat: number; lng: number };
    const exists = await c.env.DB.prepare("select 1 from spots where name = ? collate nocase").bind(name).first();
    if (exists) fail(409, "A spot with that name already exists");
    const spot = { id: newId(), name, lat, lng, maps_url: safeMapsUrl(link, lat, lng), note };
    await c.env.DB.batch([
      c.env.DB.prepare(
        "insert into spots (id, name, lat, lng, maps_url, note, created_at) values (?, ?, ?, ?, ?, ?, ?)",
      ).bind(spot.id, name, lat, lng, spot.maps_url, note, nowIso()),
      audit(c.env.DB, c.get("user").id, "create", "spot", spot.id, spot),
    ]);
    return c.json({ ...spot, archived: false }, 201);
  })
  .patch("/:id", requireRole("admin"), zValidator("json", spotEdit), async (c) => {
    const id = c.req.param("id");
    const cur = await c.env.DB.prepare("select id, name, lat, lng, maps_url, note, archived from spots where id = ?")
      .bind(id)
      .first<SpotRow>();
    if (!cur) return fail(404, "Spot not found");
    const e = c.req.valid("json");
    const next = {
      ...cur,
      name: e.name ?? cur.name,
      note: e.note ?? cur.note,
      archived: e.archived === undefined ? cur.archived : Number(e.archived),
    };
    if (e.link) {
      const ll = parseLatLng(e.link);
      if (!ll) fail(400, "Paste a Google Maps link with a pin, or coordinates");
      Object.assign(next, ll, {
        maps_url: safeMapsUrl(e.link, (ll as { lat: number }).lat, (ll as { lng: number }).lng),
      });
    }
    if (next.name.toLowerCase() !== cur.name.toLowerCase()) {
      const taken = await c.env.DB.prepare("select 1 from spots where name = ? collate nocase and id != ?")
        .bind(next.name, id)
        .first();
      if (taken) fail(409, "A spot with that name already exists");
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        "update spots set name = ?, lat = ?, lng = ?, maps_url = ?, note = ?, archived = ? where id = ?",
      ).bind(next.name, next.lat, next.lng, next.maps_url, next.note, next.archived, id),
      audit(c.env.DB, c.get("user").id, "update", "spot", id, e),
    ]);
    return c.json(toSpot(next));
  });
