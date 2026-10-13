// Only in the Android app (DESIGN.md → v2, Android app): re-register the notification token each start, offer a newer
// app version, and on first launch ask for notifications and offer the calendar link (no location).
import { useEffect, useState } from "react";
import { appUpdate, enableAppPush, openExternal, refreshAppPush } from "../lib/native.ts";
import { CalendarLink } from "./CalendarLink.tsx";
import { Sheet } from "./Sheet.tsx";

const WELCOMED = "bbt-app-welcomed";
const welcomed = () => {
  try {
    return localStorage.getItem(WELCOMED) === "1";
  } catch {
    return true;
  }
};

export function AppExtras() {
  const [update, setUpdate] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(!welcomed());
  useEffect(() => {
    refreshAppPush().catch(() => undefined);
    appUpdate()
      .then((u) => setUpdate(u?.versionName ?? null))
      .catch(() => undefined);
  }, []);
  const done = () => {
    try {
      localStorage.setItem(WELCOMED, "1");
    } catch {
      // asked again next time
    }
    setWelcome(false);
  };
  return (
    <>
      {update && (
        <div className="notice" role="status">
          A new version of the BBT app ({update}) is out.{" "}
          <button type="button" className="linkbtn" onClick={() => openExternal("/download/")}>
            Update
          </button>
        </div>
      )}
      {welcome && <Welcome onDone={done} />}
    </>
  );
}

function Welcome({ onDone }: { onDone: () => void }) {
  const [push, setPush] = useState<"off" | "on" | string>("off");
  const turnOn = async () => {
    try {
      await enableAppPush();
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
        {push === "on" ? (
          <p className="small" role="status" style={{ margin: 0 }}>
            Notifications are on.
          </p>
        ) : (
          <>
            <button type="button" className="btn btn-primary btn-sm" onClick={turnOn}>
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
          Everything you're in for, in Google Calendar, kept up to date.
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
