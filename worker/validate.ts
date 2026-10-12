// Request validation: zod schemas from shared/api.ts, with a readable 400 ({ error: "…" }) like every other error.
import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

export const validate = <T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidator(target, schema, (result, c) => {
    if (result.success) return;
    const issue = result.error.issues[0];
    const field = issue?.path.join(".");
    return c.json({ error: `${field ? `${field}: ` : ""}${issue?.message ?? "Invalid request"}` }, 400);
  });
