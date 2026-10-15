// Start spots: list (all), add (Edit), edit or archive (Admin).
import { Hono } from "hono";
import { spotEdit, spotInput } from "../../shared/api.ts";
import { isMapsHost, mapsLink, meetingLink, parseLatLng, type Spot } from "../../shared/ride.ts";
import { nyNow } from "../../shared/time.ts";
import { type AppEnv, requireRole } from "../app.ts";
import { audit, fail, newId, nowIso } from "../util.ts";
import { validate } from "../validate.ts";

// A pasted link is kept only if it points at Google Maps; otherwise the spot gets a coordinates link.
function safeMapsUrl(link: string, lat: number, lng: number): string {
  try {
    const u = new URL(link);
    if (u.protocol === "https:" && isMapsHost(u.hostname)) return u.toString();
  } catch {
    // not a URL: plain coordinates
  }
  return mapsLink(lat, lng);
}

/** Where a pasted link puts the place: a pin from a Maps link or "lat, lng", or online for a meeting link (no
 * coordinates, DESIGN.md → Virtual meet-ups). Short maps.app.goo.gl links are followed one hop here, because browsers
 * can't read cross-site redirects. */
async function locate(link: string): Promise<{ lat: number; lng: number; maps_url: string; online: number }> {
  const meeting = meetingLink(link);
  if (meeting) return { lat: 0, lng: 0, maps_url: meeting, online: 1 };
  let ll = parseLatLng(link);
  if (!ll && /^https:\/\/maps\.app\.goo\.gl\//.test(link)) {
    const res = await fetch(link, { redirect: "manual", signal: AbortSignal.timeout(5000) }).catch(() => null);
    await res?.body?.cancel();
    const location = res?.headers.get("location") ?? "";
    let decoded = location;
    try {
      decoded = decodeURI(location);
    } catch {
      // a malformed % sequence: parse the raw value
    }
    ll = parseLatLng(decoded);
  }
  if (!ll)
    return fail(
      400,
      "Paste a Google Maps link with a pin, coordinates like 41.0454, -73.6973, or a meeting link (https://…)",
    );
  return { ...ll, maps_url: safeMapsUrl(link, ll.lat, ll.lng), online: 0 };
}

const inUse = (db: D1Database, id: string) =>
  db.prepare("select 1 from activities where spot_id = ? and date >= ?").bind(id, nyNow().date).first();

type SpotRow = Omit<Spot, "online"> & { archived: number; online: number };
const toSpot = ({ archived, online, ...s }: SpotRow) => ({ ...s, online: online === 1, archived: archived === 1 });
const COLUMNS = "id, name, lat, lng, maps_url, note, online, archived";

export const spots = new Hono<AppEnv>()
  .get("/", async (c) => {
    const { results } = await c.env.DB.prepare(`select ${COLUMNS} from spots order by name`).all<SpotRow>();
    return c.json(results.map(toSpot));
  })
  .post("/", requireRole("edit"), validate("json", spotInput), async (c) => {
    const { name, link, note } = c.req.valid("json");
    const exists = await c.env.DB.prepare("select 1 from spots where name = ? collate nocase").bind(name).first();
    if (exists) fail(409, "A place with that name already exists");
    const spot = { id: newId(), name, ...(await locate(link)), note };
    await c.env.DB.batch([
      c.env.DB.prepare(
        "insert into spots (id, name, lat, lng, maps_url, note, online, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(spot.id, name, spot.lat, spot.lng, spot.maps_url, note, spot.online, nowIso()),
      audit(c.env.DB, c.get("user").id, "create", "spot", spot.id, spot),
    ]);
    return c.json(toSpot({ ...spot, archived: 0 }), 201);
  })
  .patch("/:id", requireRole("admin"), validate("json", spotEdit), async (c) => {
    const id = c.req.param("id");
    const cur = await c.env.DB.prepare(`select ${COLUMNS} from spots where id = ?`).bind(id).first<SpotRow>();
    if (!cur) return fail(404, "Place not found");
    const e = c.req.valid("json");
    const next = {
      ...cur,
      name: e.name ?? cur.name,
      note: e.note ?? cur.note,
      archived: e.archived === undefined ? cur.archived : Number(e.archived),
    };
    if (e.link) {
      const at = await locate(e.link);
      // Activities take their times and weather from whether the place is online, so it can't switch while in use
      if (at.online !== cur.online && (await inUse(c.env.DB, id)))
        fail(409, "Upcoming activities use this place; make a new place instead");
      Object.assign(next, at);
    }
    if (next.name.toLowerCase() !== cur.name.toLowerCase()) {
      const taken = await c.env.DB.prepare("select 1 from spots where name = ? collate nocase and id != ?")
        .bind(next.name, id)
        .first();
      if (taken) fail(409, "A place with that name already exists");
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        "update spots set name = ?, lat = ?, lng = ?, maps_url = ?, note = ?, online = ?, archived = ? where id = ?",
      ).bind(next.name, next.lat, next.lng, next.maps_url, next.note, next.online, next.archived, id),
      audit(c.env.DB, c.get("user").id, "update", "spot", id, e),
    ]);
    return c.json(toSpot(next));
  });
