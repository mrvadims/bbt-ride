// The phone extras (DESIGN.md → v2): on first launch of the Android app or the iPhone Home Screen app, a Welcome sheet
// that asks for notifications and offers the calendar link (no location). The Android app also re-registers its
// notification token each start and offers a newer app version.
import { useEffect, useState } from "react";
import type { Me } from "../../shared/api.ts";
import { appUpdate, enableAppPush, isApp, openExternal, refreshAppPush } from "../lib/native.ts";
import { currentSubscription, enablePush, pushSupported } from "../lib/push.ts";
import { CalendarLink } from "./CalendarLink.tsx";
import { Sheet } from "./Sheet.tsx";

const WELCOMED = "bbt-app-welcomed"; // per install: the iPhone Home Screen app has its own storage, apart from Safari
const welcomed = () => {
  try {
    return localStorage.getItem(WELCOMED) === "1";
  } catch {
    return true;
  }
};

/** Shown in the Android app and the iPhone Home Screen app. */
export function AppExtras({ me }: { me: Me }) {
  const app = isApp();
  const [update, setUpdate] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    if (app) {
      refreshAppPush().catch(() => undefined);
      appUpdate()
        .then((u) => setUpdate(u?.versionName ?? null))
        .catch(() => undefined);
      setWelcome(!welcomed());
    } else if (!welcomed()) {
      // Home Screen web app: skip the sheet if notifications are already on.
      currentSubscription().then(
        (s) => setWelcome(!s),
        () => setWelcome(true),
      );
    }
  }, [app]);
  const done = () => {
    try {
      localStorage.setItem(WELCOMED, "1");
    } catch {
      // asked again next time
    }
    setWelcome(false);
  };
  const turnOn = app
    ? enableAppPush
    : pushSupported() && me.vapidPublicKey
      ? () => enablePush(me.vapidPublicKey)
      : null;
  return (
    <>
      {update && (
        <div className="notice" role="status">
          <b>Update available:</b> BBT for Android {update}.{" "}
          <button type="button" className="linkbtn" onClick={() => openExternal("/download/")}>
            Update
          </button>
        </div>
      )}
      {welcome && (
        <Welcome onDone={done} turnOn={turnOn} calendars={app ? "Google Calendar" : "Apple or Google Calendar"} />
      )}
    </>
  );
}

function Welcome({
  onDone,
  turnOn,
  calendars,
}: {
  onDone: () => void;
  turnOn: (() => Promise<void>) | null;
  calendars: string;
}) {
  const [push, setPush] = useState<"off" | "on" | string>("off");
  const start = async () => {
    try {
      await turnOn?.();
      setPush("on");
    } catch (e) {
      setPush((e as Error).message);
    }
  };
  return (
    <Sheet label="Welcome to BBT" onClose={onDone}>
      <h2>Welcome to BBT</h2>
      <div className="sub">
        <div className="sub-h">Notifications</div>
        <p className="small muted" style={{ margin: "0 0 8px" }}>
          New activities, changes and cancellations. Choose sports later in the account menu.
        </p>
        {!turnOn ? (
          <p className="small muted" style={{ margin: 0 }}>
            Notifications need iOS 16.4 or later.
          </p>
        ) : push === "on" ? (
          <p className="small" role="status" style={{ margin: 0 }}>
            Notifications are on.
          </p>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={start}>
              Turn on notifications
            </button>
            {push !== "off" && (
              <p className="tiny" style={{ color: "var(--no-fg)", margin: "6px 0 0" }}>
                {push}
              </p>
            )}
          </>
        )}
      </div>
      <div className="sub">
        <div className="sub-h">Your calendar</div>
        <p className="small muted" style={{ margin: "0 0 8px" }}>
          Everything you're in for, in {calendars}, kept up to date.
        </p>
        <CalendarLink />
      </div>
      <div className="btnrow" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-outline" onClick={onDone}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
