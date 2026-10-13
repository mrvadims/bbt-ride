// Team settings and kit chart: read (everyone), change or reset (Admin).
import { Hono } from "hono";
import { z } from "zod";
import type { TeamSettings } from "../../shared/api.ts";
import { DEFAULT_KIT, type KitBand } from "../../shared/kit.ts";
import {
  DEFAULT_SETTINGS,
  type Settings,
  settingsChange,
  settingsProblem,
  settingsSchema,
} from "../../shared/settings.ts";
import { GROUPS, warnSchema } from "../../shared/sports.ts";
import { type AppEnv, requireRole } from "../app.ts";
import { audit, fail, nowIso } from "../util.ts";
import { validate } from "../validate.ts";

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db
    .prepare("select key, value_json from settings")
    .all<{ key: string; value_json: string }>();
  const stored = Object.fromEntries(results.map((r) => [r.key, JSON.parse(r.value_json)]));
  // Stored values override the first-run defaults; each invalid one falls back to its default (weather warnings per group).
  const valid = Object.entries(stored).filter(
    ([k, v]) => k !== "warn" && settingsSchema.shape[k as keyof Settings]?.safeParse(v).success,
  );
  const warn = Object.fromEntries(
    GROUPS.map((g) => {
      const w = warnSchema.safeParse(stored.warn?.[g]);
      return [g, w.success ? w.data : DEFAULT_SETTINGS.warn[g]];
    }),
  ) as Settings["warn"];
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(valid), warn };
}

async function loadKit(db: D1Database): Promise<KitBand[]> {
  const { results } = await db
    .prepare("select min_feel_f, name, items_json from kit_bands order by min_feel_f desc")
    .all<{ min_feel_f: number; name: string; items_json: string }>();
  return results.length
    ? results.map((r) => ({ minFeel: r.min_feel_f, name: r.name, items: JSON.parse(r.items_json) }))
    : DEFAULT_KIT;
}

// Seven bands, warmest first, each starting colder than the one above (the last one's start is ignored).
const kitSchema = z
  .array(
    z.object({
      minFeel: z.number().min(-99).max(120),
      name: z.string().trim().min(1).max(30),
      items: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    }),
  )
  .length(7)
  .refine((k) => {
    const feels = [...k.slice(0, -1).map((b) => b.minFeel), -99]; // as stored: the coldest band catches everything
    return feels.every((f, i) => i === 0 || f < (feels[i - 1] as number));
  }, "Each band must start colder than the one above it");

function kitInserts(db: D1Database, kit: KitBand[]) {
  const bands = kit.map((b, i) => (i === kit.length - 1 ? { ...b, minFeel: -99 } : b)); // the coldest band catches everything
  return [
    db.prepare("delete from kit_bands"),
    ...bands.map((b) =>
      db
        .prepare("insert into kit_bands (min_feel_f, name, items_json) values (?, ?, ?)")
        .bind(b.minFeel, b.name, JSON.stringify(b.items)),
    ),
  ];
}

const teamSettings = async (db: D1Database): Promise<TeamSettings> => {
  const [settings, kit] = await Promise.all([loadSettings(db), loadKit(db)]);
  return { settings, kit };
};

export const settings = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await teamSettings(c.env.DB)))
  .put("/", requireRole("admin"), validate("json", settingsChange), async (c) => {
    const current = await loadSettings(c.env.DB);
    const body = c.req.valid("json");
    // Only the weather groups sent change; the others keep their stored values.
    const { warn, ...rest } = body;
    const changes: Partial<Settings> = { ...rest, ...(warn ? { warn: { ...current.warn, ...warn } } : {}) };
    const problem = settingsProblem({ ...current, ...changes });
    if (problem) return fail(400, problem);
    const user = c.get("user");
    const stmts = Object.entries(changes).map(([key, value]) =>
      c.env.DB.prepare(
        "insert into settings (key, value_json, updated_by, updated_at) values (?, ?, ?, ?) on conflict (key) do update set value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      ).bind(key, JSON.stringify(value), user.id, nowIso()),
    );
    if (stmts.length) await c.env.DB.batch([...stmts, audit(c.env.DB, user.id, "update", "settings", null, changes)]);
    return c.json(await teamSettings(c.env.DB));
  })
  .put("/kit", requireRole("admin"), validate("json", kitSchema), async (c) => {
    const kit = c.req.valid("json");
    await c.env.DB.batch([...kitInserts(c.env.DB, kit), audit(c.env.DB, c.get("user").id, "update", "kit", null, kit)]);
    return c.json(await teamSettings(c.env.DB));
  })
  // Restores first-run values (not users or spots).
  .post("/reset", requireRole("admin"), async (c) => {
    await c.env.DB.batch([
      c.env.DB.prepare("delete from settings"),
      ...kitInserts(c.env.DB, DEFAULT_KIT),
      audit(c.env.DB, c.get("user").id, "reset", "settings", null),
    ]);
    return c.json<TeamSettings>({ settings: DEFAULT_SETTINGS, kit: DEFAULT_KIT });
  });
