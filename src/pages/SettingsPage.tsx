// Settings (Admin): users and invites, ride defaults, road wetness, warnings, kit chart, spots (DESIGN.md → Settings).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Invite, Me, Role, TeamSettings, UserRow } from "../../shared/api.ts";
import type { KitBand } from "../../shared/kit.ts";
import type { Settings } from "../../shared/settings.ts";
import { fmtTime, hhmmToMin } from "../../shared/time.ts";
import { Panel } from "../components/Panel.tsx";
import { api } from "../lib/api.ts";
import { type SpotWithState, useSpots, useTeam } from "../lib/data.ts";

const ROLE_LABEL: Record<Role, string> = { view: "View", edit: "Edit", admin: "Admin" };
const ROLES: Role[] = ["view", "edit", "admin"];

function useCopyLink() {
  const [shown, setShown] = useState<string | null>(null);
  const copy = async (url: string) => {
    setShown(url);
    await navigator.clipboard?.writeText(url).catch(() => undefined);
  };
  return { shown, copy, clear: () => setShown(null) };
}

function Users({ me }: { me: Me }) {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["users"], queryFn: () => api<{ users: UserRow[]; invites: Invite[] }>("/users") });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("view");
  const [error, setError] = useState<string | null>(null);
  const link = useCopyLink();
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });
  const act = useMutation({
    mutationFn: (req: { path: string; method?: string; body?: unknown }) =>
      api<{ url?: string } | undefined>(req.path, req),
    onSuccess: (res) => {
      setError(null);
      if (res?.url) link.copy(res.url);
      refresh();
    },
    onError: (e) => setError(e.message),
  });
  const users = data.data?.users ?? [];
  const invites = data.data?.invites ?? [];
  return (
    <Panel
      id="set-users"
      label="Users"
      titled
      collapsed
      summary={`${users.length} users${invites.length ? ` · ${invites.length} invited` : ""} · Google or password`}
    >
      {link.shown && (
        <div className="notice">
          <b>Link copied.</b> Send it to the person yourself (it works once):
          <input readOnly value={link.shown} onFocus={(e) => e.target.select()} style={{ marginTop: 6 }} />
          <button type="button" className="linkbtn" onClick={link.clear}>
            Done
          </button>
        </div>
      )}
      {error && (
        <p className="small" role="alert" style={{ color: "var(--no-fg)" }}>
          {error}
        </p>
      )}
      <div className="tablewrap" style={{ marginTop: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ textAlign: "left" }}>Email</th>
              <th style={{ textAlign: "left" }}>Role</th>
              <th>Sign-in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.name}
                  {u.disabled && (
                    <span className="tag" style={{ marginLeft: 6 }}>
                      disabled
                    </span>
                  )}
                </td>
                <td style={{ textAlign: "left" }}>{u.email}</td>
                <td style={{ textAlign: "left" }}>
                  {u.id === me.id ? (
                    "Admin (you)"
                  ) : (
                    <select
                      aria-label={`Role for ${u.email}`}
                      value={u.role}
                      style={{ minHeight: 32, padding: "4px 8px", width: "auto" }}
                      onChange={(e) =>
                        act.mutate({ path: `/users/${u.id}`, method: "PATCH", body: { role: e.target.value } })
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>{u.methods.map((m) => (m === "google" ? "Google" : "Password")).join(", ") || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {u.id !== me.id && (
                    <>
                      <button
                        type="button"
                        className="linkbtn"
                        onClick={() => act.mutate({ path: `/users/${u.id}/reset-link`, body: {} })}
                      >
                        Reset link
                      </button>{" "}
                      <button
                        type="button"
                        className="linkbtn"
                        onClick={() =>
                          act.mutate({ path: `/users/${u.id}`, method: "PATCH", body: { disabled: !u.disabled } })
                        }
                      >
                        {u.disabled ? "Enable" : "Disable"}
                      </button>{" "}
                      <button
                        type="button"
                        className="linkbtn"
                        onClick={() =>
                          window.confirm(
                            `Delete ${u.name}? Their RSVPs are removed; their messages stay as "Former member".`,
                          ) && act.mutate({ path: `/users/${u.id}`, method: "DELETE" })
                        }
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {invites.map((i) => (
              <tr key={i.email}>
                <td className="muted">Invited</td>
                <td style={{ textAlign: "left" }}>{i.email}</td>
                <td style={{ textAlign: "left" }}>{ROLE_LABEL[i.role]}</td>
                <td className="muted">
                  until {new Date(i.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </td>
                <td>
                  <button
                    type="button"
                    className="linkbtn"
                    onClick={() => act.mutate({ path: "/users/invites", body: { email: i.email, role: i.role } })}
                  >
                    New link
                  </button>{" "}
                  <button
                    type="button"
                    className="linkbtn"
                    onClick={() =>
                      act.mutate({ path: `/users/invites/${encodeURIComponent(i.email)}`, method: "DELETE" })
                    }
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="controls"
        style={{ margin: "12px 0 0" }}
        onSubmit={(e) => {
          e.preventDefault();
          act.mutate({ path: "/users/invites", body: { email, role } }, { onSuccess: () => setEmail("") });
        }}
      >
        <label className="field" style={{ flex: "1 1 220px" }}>
          Invite by email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@gmail.com"
            autoComplete="off"
          />
        </label>
        <label className="field">
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled={act.isPending}>
          Invite
        </button>
      </form>
      <p className="tiny muted" style={{ margin: "8px 0 0" }}>
        View: see rides, RSVP and post. Edit: also plan, publish, edit and cancel rides, and add start spots. Admin:
        also settings and users.
        <br />
        An invite link (7 days, one use) lets the person continue with Google or set a password. A reset link (24 h, one
        use) lets them choose a new password and signs them out elsewhere.
      </p>
    </Panel>
  );
}

function NumberField({
  k,
  label,
  unit,
  step,
  s,
  onSave,
}: {
  k: keyof Settings;
  label: string;
  unit?: string;
  step: number;
  s: Settings;
  onSave: (p: Partial<Settings>) => void;
}) {
  return (
    <label className="field">
      {label}
      {unit ? ` (${unit})` : ""}
      <input
        type="number"
        step={step}
        defaultValue={String(s[k])}
        key={String(s[k])}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(v) && v !== s[k]) onSave({ [k]: v });
        }}
      />
    </label>
  );
}

function KitEditor({ kit, onSave }: { kit: KitBand[]; onSave: (k: KitBand[]) => void }) {
  const [rows, setRows] = useState(() => kit.map((b) => ({ ...b, text: b.items.join(", ") })));
  const save = () =>
    onSave(
      rows.map((r) => ({
        minFeel: r.minFeel,
        name: r.name.trim(),
        items: r.text
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      })),
    );
  return (
    <>
      <div className="tablewrap" style={{ marginTop: 0 }}>
        <table>
          <thead>
            <tr>
              <th>From bike feel (°F)</th>
              <th style={{ textAlign: "left" }}>Band</th>
              <th style={{ textAlign: "left" }}>Kit (comma-separated)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  {i === rows.length - 1 ? (
                    "colder"
                  ) : (
                    <input
                      type="number"
                      value={r.minFeel}
                      style={{ width: 80 }}
                      onChange={(e) =>
                        setRows(rows.map((x, j) => (j === i ? { ...x, minFeel: Number(e.target.value) } : x)))
                      }
                    />
                  )}
                </td>
                <td style={{ textAlign: "left" }}>
                  <input
                    value={r.name}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                </td>
                <td style={{ textAlign: "left", whiteSpace: "normal", minWidth: 260 }}>
                  <input
                    value={r.text}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="btnrow" style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={save}>
          Save kit chart
        </button>
      </div>
    </>
  );
}

function Spots() {
  const qc = useQueryClient();
  const spots = useSpots().data ?? [];
  const [error, setError] = useState<string | null>(null);
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api<SpotWithState>(`/spots/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["spots"] });
      qc.invalidateQueries({ queryKey: ["weather"] });
    },
    onError: (e) => setError(e.message),
  });
  const active = spots.filter((s) => !s.archived).length;
  return (
    <Panel
      id="set-spots"
      label="Spots"
      titled
      collapsed
      summary={`${active} active${spots.length > active ? ` · ${spots.length - active} archived` : ""}`}
    >
      {error && (
        <p className="small" role="alert" style={{ color: "var(--no-fg)" }}>
          {error}
        </p>
      )}
      {spots.map((sp) => (
        <div key={sp.id} className="sub">
          <div className="settings-grid">
            <label className="field">
              Name
              <input
                defaultValue={sp.name}
                onBlur={(e) =>
                  e.target.value.trim() !== sp.name && edit.mutate({ id: sp.id, body: { name: e.target.value } })
                }
              />
            </label>
            <label className="field">
              Move the pin (Maps link or "lat, lng")
              <input
                placeholder={`${sp.lat}, ${sp.lng}`}
                onBlur={(e) => e.target.value.trim() && edit.mutate({ id: sp.id, body: { link: e.target.value } })}
              />
            </label>
          </div>
          <label className="field">
            Parking notes
            <textarea
              defaultValue={sp.note}
              onBlur={(e) => e.target.value !== sp.note && edit.mutate({ id: sp.id, body: { note: e.target.value } })}
            />
          </label>
          <button
            type="button"
            className="linkbtn"
            onClick={() => edit.mutate({ id: sp.id, body: { archived: !sp.archived } })}
          >
            {sp.archived ? "Restore to the pick list" : "Archive (stays on past rides)"}
          </button>
        </div>
      ))}
    </Panel>
  );
}

export function SettingsPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const team = useTeam().data;
  const [error, setError] = useState<string | null>(null);
  const done = (data: TeamSettings) => {
    qc.setQueryData(["settings"], data);
    setError(null);
  };
  const save = useMutation({
    mutationFn: (p: Partial<Settings>) => api<TeamSettings>("/settings", { method: "PUT", body: p }),
    onSuccess: done,
    onError: (e) => setError(e.message),
  });
  const saveKit = useMutation({
    mutationFn: (k: KitBand[]) => api<TeamSettings>("/settings/kit", { method: "PUT", body: k }),
    onSuccess: done,
    onError: (e) => setError(e.message),
  });
  const reset = useMutation({ mutationFn: () => api<TeamSettings>("/settings/reset", { body: {} }), onSuccess: done });
  if (!team) return <p className="muted small">Loading…</p>;
  const s = team.settings;
  const num = (k: keyof Settings, label: string, step = 1, unit?: string) => (
    <NumberField k={k} label={label} unit={unit} step={step} s={s} onSave={(p) => save.mutate(p)} />
  );
  return (
    <>
      <h1 className="sr">Settings</h1>
      <p className="tiny muted" style={{ margin: "-4px 0 10px" }}>
        Team-wide settings, stored in imperial units. Changes save when you leave a field.
      </p>
      {error && (
        <p className="small" role="alert" style={{ color: "var(--no-fg)" }}>
          {error}
        </p>
      )}
      <div className="panels">
        <Users me={me} />
        <Panel
          id="set-defaults"
          label="Ride defaults"
          titled
          collapsed
          summary={`${fmtTime(hhmmToMin(s.rollout))} · ${s.durationH} h · ${s.pace} mph · coffee ${s.stopMin} min · regroups ${s.regroupPct}%`}
        >
          <div className="settings-grid">
            {num("pace", "Pace", 0.5, "mph")}
            <label className="field">
              Roll-out
              <input
                type="time"
                step={900}
                defaultValue={s.rollout}
                key={s.rollout}
                onBlur={(e) =>
                  e.target.value && e.target.value !== s.rollout && save.mutate({ rollout: e.target.value })
                }
              />
            </label>
            {num("durationH", "Weather window before a route is picked", 0.5, "h")}
            {num("stopMin", "Coffee stop", 5, "min")}
            {num("regroupPct", "Regroup buffer", 1, "% of moving time")}
          </div>
        </Panel>
        <Panel
          id="set-road"
          label="Road wetness"
          titled
          collapsed
          summary={`${s.lookback} h look-back · wet ≥ ${s.wetMm} mm · drying ≥ ${s.dryingMm} mm`}
        >
          <div className="settings-grid">
            {num("lookback", "Look-back", 1, "hours")}
            {num("wetMm", "Wet at film ≥", 0.05, "mm")}
            {num("dryingMm", "Drying at film ≥", 0.05, "mm")}
          </div>
          <p className="tiny muted" style={{ margin: "8px 0 0" }}>
            0.1" of rain ≈ 2.5 mm of water; the film is capped at 2 mm (runoff).
          </p>
        </Panel>
        <Panel
          id="set-warn"
          label="Warnings"
          titled
          collapsed
          summary={`cold < ${s.feelCaution}° · heat ≥ ${s.heatCaution}° · wind ≥ ${s.windCaution} · gusts ≥ ${s.gustCaution} · rain ≥ ${s.rainProbCaution}%`}
        >
          <p className="tiny muted" style={{ margin: "0 0 8px" }}>
            A warning shows when a value crosses the first threshold (amber) and turns red at the second.
          </p>
          <div className="settings-grid">
            {num("feelCaution", "Cold: bike feel <", 1, "°F")}
            {num("feelNoGo", "Red below", 1, "°F")}
            {num("heatCaution", "Heat: real feel ≥", 1, "°F")}
            {num("heatNoGo", "Red at", 1, "°F")}
            {num("windCaution", "Wind ≥", 1, "mph")}
            {num("windNoGo", "Red at", 1, "mph")}
            {num("gustCaution", "Gusts ≥", 1, "mph")}
            {num("gustNoGo", "Red at", 1, "mph")}
            {num("rainProbCaution", "Rain chance ≥", 5, "%")}
            {num("rainProbNoGo", "Red at", 5, "%")}
            {num("rainAmtCaution", "Rain amount ≥", 0.01, "in")}
            {num("rainAmtNoGo", "Red at", 0.01, "in")}
          </div>
          <p className="tiny muted" style={{ margin: "8px 0 0" }}>
            Roads: Drying = amber, Wet = red. Thunderstorms = red. Low light: roll-out within 30 min of sunrise. NWS
            warnings = red, watches and advisories = amber.
          </p>
        </Panel>
        <Panel
          id="set-kit"
          label="Kit chart"
          titled
          collapsed
          summary={`${team.kit.length} bands on bike feel · rider offset ±5°`}
        >
          <KitEditor key={JSON.stringify(team.kit)} kit={team.kit} onSave={(k) => saveKit.mutate(k)} />
        </Panel>
        <Spots />
      </div>
      <div className="btnrow" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() =>
            window.confirm("Reset ride defaults, thresholds and the kit chart to first-run values?") && reset.mutate()
          }
        >
          Reset to defaults
        </button>
      </div>
    </>
  );
}
