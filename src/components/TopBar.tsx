// Top bar (the only navigation): logo home, Team for everyone, Plan and Settings for roles that have them, and the account menu.
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { type Me, ROLE_LABEL } from "../../shared/api.ts";
import { SPORT_LABEL, type Sport } from "../../shared/sports.ts";
import { api, authClient } from "../lib/api.ts";
import { useTeamSettings } from "../lib/data.ts";
import { appPushOn, disableAppPush, enableAppPush, isAndroidBrowser, isApp, isIosBrowser } from "../lib/native.ts";
import { type Prefs, setPref, usePrefs } from "../lib/prefs.ts";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../lib/push.ts";
import { Link, navigate, useLocation } from "../lib/router.tsx";
import { CalendarLink } from "./CalendarLink.tsx";
import { ContactForm } from "./Contact.tsx";
import { GearIcon, Logo, PeopleIcon, PlanIcon } from "./icons.tsx";
import { Sheet } from "./Sheet.tsx";

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
  const app = isApp(); // the Android app: Firebase instead of Web Push
  useEffect(() => {
    if (app) appPushOn().then(setOn, () => setOn(false));
    else currentSubscription().then((s) => setOn(Boolean(s)));
  }, [app]);
  if (!app && (!pushSupported() || !me.vapidPublicKey))
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
      if (app) await (want ? enableAppPush() : disableAppPush());
      else if (want) await enablePush(me.vapidPublicKey);
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
// until turned off. Changes and cancellations notify everyone with notifications on, whatever the sport.
function NotifySports({ me }: { me: Me }) {
  const team = useTeamSettings().data;
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  if (!team) return null;
  const offered: Sport[] = [...team.settings.sports, "other"];
  // Shown at once and saved one sport at a time, so quick taps on several sports all stick.
  const set = (sport: Sport, off: boolean) =>
    qc.setQueryData<Me>(
      ["me"],
      (m) =>
        m && {
          ...m,
          mutedSports: off
            ? [...m.mutedSports.filter((s) => s !== sport), sport]
            : m.mutedSports.filter((s) => s !== sport),
        },
    );
  const toggle = async (sport: Sport) => {
    setNote("");
    const off = !qc.getQueryData<Me>(["me"])?.mutedSports.includes(sport);
    set(sport, off);
    try {
      await api<Me>(`/me/muted/${sport}`, { method: "PUT", body: { off } });
    } catch (e) {
      set(sport, !off);
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

// The member's display name, shown to the team; Google sign-ups start with their Google name.
function Name({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!editing)
    return (
      <div className="who-name">
        <b>{me.name}</b>
        <button type="button" className="linkbtn tiny" onClick={() => setEditing(true)}>
          Edit name
        </button>
      </div>
    );
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    setNote("");
    if (name === me.name) return setEditing(false);
    setBusy(true);
    const { error } = await authClient.updateUser({ name });
    setBusy(false);
    if (error) return setNote(error.message ?? "Couldn't save your name.");
    setEditing(false);
    // the name also shows in Team, Who's in and the threads
    for (const key of ["me", "members", "activity", "activities"]) await qc.invalidateQueries({ queryKey: [key] });
  };
  return (
    <form className="row2" onSubmit={save}>
      <label className="field">
        Your name (shown to the team)
        <input
          name="name"
          defaultValue={me.name}
          autoComplete="name"
          required
          maxLength={80}
          ref={(el) => el?.focus()}
        />
      </label>
      <div className="row-btns">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          Save
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {note && (
        <span className="tiny" style={{ color: "var(--no-fg)" }}>
          {note}
        </span>
      )}
    </form>
  );
}

export function TopBar({ me }: { me: Me | null }) {
  const prefs = usePrefs();
  const { parts } = useLocation();
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState(false);
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
    // the next person on this device shouldn't get this person's notifications
    await (isApp() ? disableAppPush() : disablePush()).catch(() => undefined);
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
              <Link className="navbtn" href="/team" title="Team" aria-current={page === "team" ? "page" : undefined}>
                <PeopleIcon />
                <span>Team</span>
              </Link>
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
            <Name me={me} />
            <span className="tiny muted">
              {ROLE_LABEL[me.role]} · signed in with {method}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => {
              setOpen(false);
              setContact(true);
            }}
          >
            My contact info
          </button>
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
          {isAndroidBrowser() && (
            <a className="btn btn-outline btn-sm" href="/download/#android">
              Install on Android
            </a>
          )}
          {isIosBrowser() && (
            <a className="btn btn-outline btn-sm" href="/download/#iphone">
              Install on iPhone
            </a>
          )}
          <Link className="btn btn-outline btn-sm help-link" href="/announcements" onClick={() => setOpen(false)}>
            Announcements <span aria-hidden="true">›</span>
          </Link>
          <div className="row2">
            <span className="tiny muted">Help</span>
            <Link className="btn btn-outline btn-sm help-link" href="/help/garmin" onClick={() => setOpen(false)}>
              Routes on your Garmin <span aria-hidden="true">›</span>
            </Link>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
      {me && contact && (
        <Sheet label="My contact info" onClose={() => setContact(false)}>
          <ContactForm me={me} onDone={() => setContact(false)} />
        </Sheet>
      )}
    </header>
  );
}
