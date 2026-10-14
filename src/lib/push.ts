// Notifications on this device: a Web Push subscription registered with the Worker (DESIGN.md → Notifications).
import { api } from "./api.ts";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const urlBase64ToBytes = (s: string) => {
  const b64 = (s + "=".repeat((4 - (s.length % 4)) % 4)).replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(vapidPublicKey: string): Promise<void> {
  if ((await Notification.requestPermission()) !== "granted")
    throw new Error("Notifications are blocked for this site in your browser settings.");
  await navigator.serviceWorker.register("/sw.js");
  const reg = await navigator.serviceWorker.ready; // subscribing needs an active worker
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToBytes(vapidPublicKey),
  });
  const json = sub.toJSON();
  try {
    await api("/push", { body: { endpoint: json.endpoint, keys: json.keys } });
  } catch (err) {
    await sub.unsubscribe(); // keep the switch truthful: on only if the Worker has it
    throw err;
  }
}

/** At start, when this device's notifications are on: tells the Worker again, as the Android app does with its token.
 * The Worker may have dropped the subscription (the push service once reported it gone, or another member turned
 * notifications on here), while the browser still shows the switch as on. A subscription made with an older key is
 * replaced, since the push service would refuse every message for it. */
export async function refreshPush(vapidPublicKey: string): Promise<void> {
  if (!vapidPublicKey || !pushSupported() || Notification.permission !== "granted") return;
  let sub = await currentSubscription();
  if (!sub) return;
  const key = sub.options.applicationServerKey;
  const want = urlBase64ToBytes(vapidPublicKey);
  if (key && !(key.byteLength === want.length && new Uint8Array(key).every((b, i) => b === want[i]))) {
    await sub.unsubscribe();
    const reg = await navigator.serviceWorker.ready;
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  }
  const json = sub.toJSON();
  await api("/push", { body: { endpoint: json.endpoint, keys: json.keys } });
}

/** Unsubscribes this device first (so it stops even if the server call fails), then tells the Worker. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await sub.unsubscribe();
  await api("/push", { method: "DELETE", body: { endpoint: sub.endpoint } });
}
