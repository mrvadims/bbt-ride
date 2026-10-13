// Top bar (the only navigation): logo home, Plan and Settings icons for roles that have them, and the account menu.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { type Me, ROLE_LABEL } from "../../shared/api.ts";
import { SPORT_LABEL, type Sport } from "../../shared/sports.ts";
import { api, authClient } from "../lib/api.ts";
import { useTeam } from "../lib/data.ts";
import { type Prefs, setPref, usePrefs } from "../lib/prefs.ts";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../lib/push.ts";
import { Link, navigate, useLocation } from "../lib/router.tsx";
import { CalendarLink } from "./CalendarLink.tsx";
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
        <span className="tiny muted">Notifications</span>
        <span className="tiny muted">
          {me.vapidPublicKey
            ? "Not supported in this browser. On iPhone, add BBT to your Home Screen first."
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
        label="Notifications"
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

// Which sports' new activities to hear about (DESIGN.md → v2, Notifications): the team's sports plus Other, all on
// until turned off. Updates to activities someone is In for always notify.
function NotifySports({ me }: { me: Me }) {
  const team = useTeam().data;
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  if (!team) return null;
  const offered: Sport[] = [...team.settings.sports, "other"];
  const toggle = async (sport: Sport) => {
    setNote("");
    const muted = me.mutedSports.includes(sport)
      ? me.mutedSports.filter((s) => s !== sport)
      : [...me.mutedSports, sport];
    try {
      qc.setQueryData(["me"], await api<Me>("/me/muted", { method: "PUT", body: { sports: muted } }));
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  return (
    <div className="row2">
      <span className="tiny muted">Tell me about new</span>
      <div className="filters" role="group" aria-label="Tell me about new">
        {offered.map((s) => (
          <button key={s} type="button" aria-pressed={!me.mutedSports.includes(s)} onClick={() => toggle(s)}>
            {SPORT_LABEL[s]}
          </button>
        ))}
      </div>
      {note && (
        <span className="tiny" style={{ color: "var(--no-fg)" }}>
          {note}
        </span>
      )}
    </div>
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
    await disablePush().catch(() => undefined); // the next person on this device shouldn't get this person's notifications
    await authClient.signOut();
    qc.clear();
    navigate("/signin");
  };
  const page = parts[0] ?? "";
  const method = me?.methods.includes("google") ? "Google" : "password";

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brandlink" href="/" aria-label="BBT home">
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
                  title="Plan an activity"
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
          <NotifySports me={me} />
          <div className="row2">
            <span className="tiny muted">Calendar link · activities you're In for</span>
            <CalendarLink />
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
