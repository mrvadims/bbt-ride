// Top bar (the only navigation): logo home, Plan and Settings icons for roles that have them, and the account menu.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { type Me, ROLE_LABEL } from "../../shared/api.ts";
import { authClient } from "../lib/api.ts";
import { type Prefs, setPref, usePrefs } from "../lib/prefs.ts";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../lib/push.ts";
import { Link, navigate, useLocation } from "../lib/router.tsx";
import { GearIcon, Logo, PlanIcon } from "./icons.tsx";

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="row2">
      <span className="tiny muted">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Notifications({ me }: { me: Me }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    currentSubscription().then((s) => setOn(Boolean(s)));
  }, []);
  if (!pushSupported() || !me.vapidPublicKey)
    return (
      <div className="row2">
        <span className="tiny muted">Ride notifications</span>
        <span className="tiny muted">
          {me.vapidPublicKey
            ? "Not supported in this browser. On iPhone, add BBT Ride to your Home Screen first."
            : "Not set up yet."}
        </span>
      </div>
    );
  const change = async (want: boolean) => {
    setNote("");
    try {
      if (want) await enablePush(me.vapidPublicKey);
      else await disablePush();
      setOn(want);
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  return (
    <>
      <Seg
        label="Ride notifications"
        value={on ? "on" : "off"}
        options={[
          ["off", "Off"],
          ["on", "On"],
        ]}
        onChange={(v) => change(v === "on")}
      />
      {note && (
        <span className="tiny" style={{ color: "var(--no-fg)" }}>
          {note}
        </span>
      )}
    </>
  );
}

export function TopBar({ me }: { me: Me | null }) {
  const prefs = usePrefs();
  const { parts } = useLocation();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signOut = async () => {
    await authClient.signOut();
    qc.clear();
    navigate("/signin");
  };
  const page = parts[0] ?? "ride";
  const method = me?.methods.includes("google") ? "Google" : "password";

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brandlink" href="/" aria-label="BBT Ride home">
          <Logo />
        </Link>
        <span className="spacer" />
        {me && (
          <>
            <nav className="topnav" aria-label="Main">
              {me.role !== "view" && (
                <Link
                  className="navbtn"
                  href="/plan"
                  title="Plan a ride"
                  aria-current={page === "plan" ? "page" : undefined}
                >
                  <PlanIcon />
                  <span>Plan</span>
                </Link>
              )}
              {me.role === "admin" && (
                <Link
                  className="navbtn"
                  href="/settings"
                  title="Settings"
                  aria-current={page === "settings" ? "page" : undefined}
                >
                  <GearIcon />
                  <span>Settings</span>
                </Link>
              )}
            </nav>
            <button
              ref={button}
              className="avatar"
              type="button"
              aria-expanded={open}
              aria-controls="acctmenu"
              aria-label="Account menu"
              title="Account"
              onClick={() => setOpen(!open)}
            >
              {me.name.trim()[0]?.toUpperCase() ?? "?"}
            </button>
          </>
        )}
      </div>
      {me && open && (
        <div className="acctmenu" id="acctmenu" ref={menu}>
          <div className="who">
            <b>{me.name}</b>
            <span className="tiny muted">
              {ROLE_LABEL[me.role]} · signed in with {method}
            </span>
          </div>
          <Seg<Prefs["theme"]>
            label="Theme"
            value={prefs.theme}
            options={[
              ["auto", "Auto"],
              ["light", "Light"],
              ["dark", "Dark"],
            ]}
            onChange={(v) => setPref("theme", v)}
          />
          <Seg<Prefs["units"]>
            label="Units"
            value={prefs.units}
            options={[
              ["imperial", "°F · mi"],
              ["metric", "°C · km"],
            ]}
            onChange={(v) => setPref("units", v)}
          />
          <Notifications me={me} />
          <button type="button" className="btn btn-outline btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
