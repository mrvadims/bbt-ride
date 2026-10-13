// The Android app (DESIGN.md → v2, Android app): the same web app inside a Capacitor WebView, with the phone's own
// notifications, Google sign-in, share sheet and links out through the BbtNative plugin (android/…/BbtNativePlugin.java).
// In a browser none of this runs: isApp() is false.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { api } from "./api.ts";

interface BbtNative {
  info(): Promise<{ versionCode: number; versionName: string; pushConfigured: boolean }>;
  pushPermission(): Promise<{ state: "granted" | "denied" | "prompt" | "prompt-with-rationale" }>;
  pushRegister(): Promise<{ token: string }>;
  pushUnregister(): Promise<void>;
  googleSignIn(): Promise<{ idToken: string }>;
  share(o: { title: string; text: string; url: string }): Promise<void>;
  openExternal(o: { url: string }): Promise<void>;
}

export const bbt = registerPlugin<BbtNative>("BbtNative");
export const isApp = () => Capacitor.isNativePlatform();
/** An Android phone's browser, where the account menu offers the app. */
export const isAndroidBrowser = () => !isApp() && /Android/i.test(navigator.userAgent);

// The Firebase token this device registered with the Worker (the switch is on while it's here).
const TOKEN_KEY = "bbt-fcm-token";
const stored = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const store = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private storage unavailable: the switch just shows off next time
  }
};

export async function appPushOn(): Promise<boolean> {
  return Boolean(stored()) && (await bbt.pushPermission()).state === "granted";
}

export async function enableAppPush(): Promise<void> {
  const { token } = await bbt.pushRegister();
  await api("/push/app", { body: { token } });
  store(token);
}

export async function disableAppPush(): Promise<void> {
  const token = stored();
  store(null);
  await bbt.pushUnregister().catch(() => undefined);
  if (token) await api("/push", { method: "DELETE", body: { endpoint: token } });
}

/** Each start: Firebase may have rotated the token, so register the current one again (no prompt; already allowed). */
export async function refreshAppPush(): Promise<void> {
  if (!(await appPushOn().catch(() => false))) return;
  const { token } = await bbt.pushRegister();
  if (token !== stored()) {
    await api("/push/app", { body: { token } });
    store(token);
  }
}

/** The newest Android app on the download page, when this one is older. */
export async function appUpdate(): Promise<{ versionName: string } | null> {
  const [mine, latest] = await Promise.all([
    bbt.info(),
    fetch("/download/android.json", { cache: "no-store" }).then((r) =>
      r.ok ? (r.json() as Promise<{ versionCode: number; versionName: string }>) : null,
    ),
  ]);
  return latest && latest.versionCode > mine.versionCode ? { versionName: latest.versionName } : null;
}

export const openExternal = (url: string) => bbt.openExternal({ url: new URL(url, location.origin).href });
