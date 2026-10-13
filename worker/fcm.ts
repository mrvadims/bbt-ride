// Firebase Cloud Messaging for the Android app (DESIGN.md → v2, Notifications → Delivery). The Worker signs a Google
// OAuth token from the service-account key (secret FCM_SERVICE_ACCOUNT) and keeps it in KV for under an hour, so a
// queue run signs at most once. Messages are data-only; the app draws the notification (BbtMessagingService).

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string; // PEM, PKCS #8
}
export interface FcmAuth {
  project: string;
  token: string;
}

const TOKEN_KEY = "fcm-access-token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

/** The service account's signed JWT asking Google for a messaging token (RFC 7523). */
export async function serviceJwt(sa: ServiceAccount, nowSec: number): Promise<string> {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }),
  );
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(sig)}`;
}

/** A messaging token, from KV or freshly signed. Null when FCM isn't set up. */
export async function fcmAuth(env: Env): Promise<FcmAuth | null> {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT) as ServiceAccount;
  const cached = await env.CACHE.get(TOKEN_KEY);
  if (cached) return { project: sa.project_id, token: cached };
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: await serviceJwt(sa, Math.floor(Date.now() / 1000)),
    }),
  });
  if (!res.ok) throw new Error(`FCM sign-in failed: ${res.status} ${await res.text()}`);
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  await env.CACHE.put(TOKEN_KEY, access_token, { expirationTtl: Math.max(60, Math.min(3300, expires_in - 300)) });
  return { project: sa.project_id, token: access_token };
}

/** Sends one notification (the same JSON the service worker gets) to one app install. */
export async function sendFcm(env: Env, auth: FcmAuth, token: string, data: string): Promise<"sent" | "gone"> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${auth.project}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token, data: { json: data }, android: { priority: "HIGH", ttl: "86400s" } } }),
  });
  if (res.ok) {
    await res.body?.cancel();
    return "sent";
  }
  const text = await res.text();
  // The app was uninstalled or its token replaced.
  if (res.status === 404 || /UNREGISTERED|not a valid FCM registration token/i.test(text)) return "gone";
  if (res.status === 401) await env.CACHE.delete(TOKEN_KEY); // the next run signs a new token
  throw new Error(`FCM send failed: ${res.status} ${text.slice(0, 200)}`);
}
