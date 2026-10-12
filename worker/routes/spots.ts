// Start spots: list (all), add (Edit), edit or archive (Admin).
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { spotEdit, spotInput } from "../../shared/api.ts";
import { mapsLink, parseLatLng, type Spot } from "../../shared/ride.ts";
import { type AppEnv, requireRole } from "../app.ts";
import { audit, fail, newId, nowIso } from "../util.ts";

// A pasted link is kept only if it points at Google Maps; otherwise the spot gets a coordinates link.
const MAPS_HOSTS = /^((www\.)?google\.com|maps\.google\.com|maps\.app\.goo\.gl)$/;
function safeMapsUrl(link: string, lat: number, lng: number): string {
  try {
    const u = new URL(link);
    if (u.protocol === "https:" && MAPS_HOSTS.test(u.hostname)) return u.toString();
  } catch {
    // not a URL: plain coordinates
  }
  return mapsLink(lat, lng);
}

/** The pin in a pasted Maps link or "lat, lng". Short maps.app.goo.gl links are followed one hop here, because browsers can't read cross-site redirects. */
async function locate(link: string): Promise<{ lat: number; lng: number; maps_url: string }> {
  let ll = parseLatLng(link);
  if (!ll && /^https:\/\/maps\.app\.goo\.gl\//.test(link)) {
    const res = await fetch(link, { redirect: "manual", signal: AbortSignal.timeout(5000) }).catch(() => null);
    await res?.body?.cancel();
    ll = parseLatLng(decodeURIComponent(res?.headers.get("location") ?? ""));
  }
  if (!ll) return fail(400, "Paste a Google Maps link with a pin, or coordinates like 41.0454, -73.6973");
  return { ...ll, maps_url: safeMapsUrl(link, ll.lat, ll.lng) };
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
  .post("/", requireRole("edit"), zValidator("json", spotInput), async (c) => {
    const { name, link, note } = c.req.valid("json");
    const exists = await c.env.DB.prepare("select 1 from spots where name = ? collate nocase").bind(name).first();
    if (exists) fail(409, "A spot with that name already exists");
    const spot = { id: newId(), name, ...(await locate(link)), note };
    await c.env.DB.batch([
      c.env.DB.prepare(
        "insert into spots (id, name, lat, lng, maps_url, note, created_at) values (?, ?, ?, ?, ?, ?, ?)",
      ).bind(spot.id, name, spot.lat, spot.lng, spot.maps_url, note, nowIso()),
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
    if (e.link) Object.assign(next, await locate(e.link));
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
