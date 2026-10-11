// Small helpers shared by the Worker modules.
import { HTTPException } from "hono/http-exception";

export const nowIso = (): string => new Date().toISOString();
export const newId = (): string => crypto.randomUUID();

/** 32 random bytes, base64url: used for invite and reset links. */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const fail = (status: 400 | 401 | 403 | 404 | 409 | 502, message: string): never => {
  throw new HTTPException(status, { message });
};

/** Records who changed what (DESIGN.md → Audit). */
export function audit(
  db: D1Database,
  userId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  diff?: unknown,
) {
  return db
    .prepare("insert into audit_log (user_id, action, entity, entity_id, diff_json, at) values (?, ?, ?, ?, ?, ?)")
    .bind(userId, action, entity, entityId, diff === undefined ? null : JSON.stringify(diff), nowIso());
}
