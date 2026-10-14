// Small helpers shared by the Worker modules.
import { HTTPException } from "hono/http-exception";

export const nowIso = (): string => new Date().toISOString();
export const newId = (): string => crypto.randomUUID();
/** Written in the same batch: an audit row and the note it posted carry timestamps a moment apart. */
export const sameBatch = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) < 5000;

/** Base64url without padding, of bytes or of a string's UTF-8 (tokens, signatures, JWTs). */
export function b64url(data: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** 32 random bytes, base64url: used for invite and reset links. */
export const randomToken = (): string => b64url(crypto.getRandomValues(new Uint8Array(32)));

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
