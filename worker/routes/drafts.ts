// The Plan form's autosaved draft, one per editor (DESIGN.md → Drafts and changes).
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireRole } from "../app.ts";
import { nowIso } from "../util.ts";
import { validate } from "../validate.ts";

const draftInput = z.object({ rideId: z.string().max(64).nullable(), form: z.record(z.string(), z.unknown()) });

export const drafts = new Hono<AppEnv>()
  .use(requireRole("edit"))
  .get("/", async (c) => {
    const row = await c.env.DB.prepare("select ride_id, form_json from drafts where user_id = ?")
      .bind(c.get("user").id)
      .first<{ ride_id: string | null; form_json: string }>();
    return c.json(row ? { rideId: row.ride_id, form: JSON.parse(row.form_json) } : null);
  })
  .put("/", validate("json", draftInput), async (c) => {
    const { rideId: asked, form } = c.req.valid("json");
    // The ride being edited may have been deleted meanwhile; keep the draft, drop the link.
    const rideId =
      asked && (await c.env.DB.prepare("select 1 from rides where id = ?").bind(asked).first()) ? asked : null;
    const json = JSON.stringify(form);
    if (json.length > 20_000) return c.json({ error: "Draft too large" }, 400);
    await c.env.DB.prepare(
      "insert into drafts (user_id, ride_id, form_json, updated_at) values (?, ?, ?, ?) on conflict (user_id) do update set ride_id = excluded.ride_id, form_json = excluded.form_json, updated_at = excluded.updated_at",
    )
      .bind(c.get("user").id, rideId, json, nowIso())
      .run();
    return c.body(null, 204);
  })
  .delete("/", async (c) => {
    await c.env.DB.prepare("delete from drafts where user_id = ?").bind(c.get("user").id).run();
    return c.body(null, 204);
  });
