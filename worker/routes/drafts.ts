// The Plan form's autosaved draft, one per editor (DESIGN.md → Plan a ride → Drafts and changes).
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireRole } from "../app.ts";
import { nowIso } from "../util.ts";
import { validate } from "../validate.ts";

const draftInput = z.object({ form: z.record(z.string(), z.unknown()) });

export const drafts = new Hono<AppEnv>()
  .use(requireRole("edit"))
  .get("/", async (c) => {
    const row = await c.env.DB.prepare("select form_json from drafts where user_id = ?")
      .bind(c.get("user").id)
      .first<{ form_json: string }>();
    return c.json(row ? { form: JSON.parse(row.form_json) } : null);
  })
  .put("/", validate("json", draftInput), async (c) => {
    const json = JSON.stringify(c.req.valid("json").form);
    if (json.length > 20_000) return c.json({ error: "Draft too large" }, 400);
    await c.env.DB.prepare(
      "insert into drafts (user_id, form_json, updated_at) values (?, ?, ?) on conflict (user_id) do update set form_json = excluded.form_json, updated_at = excluded.updated_at",
    )
      .bind(c.get("user").id, json, nowIso())
      .run();
    return c.body(null, 204);
  })
  .delete("/", async (c) => {
    await c.env.DB.prepare("delete from drafts where user_id = ?").bind(c.get("user").id).run();
    return c.body(null, 204);
  });
