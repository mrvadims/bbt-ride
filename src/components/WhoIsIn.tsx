// Who's in panel: In / Out (route choice only for In with an alternate route) and who answered. The thread is its own
// panel below (Messages.tsx).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ActivityDetail, Me } from "../../shared/api.ts";
import { api } from "../lib/api.ts";
import { PersonButton } from "./Contact.tsx";
import { Panel } from "./Panel.tsx";

export function WhoIsIn({ act, me, past }: { act: ActivityDetail; me: Me; past: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const done = (data: ActivityDetail) => {
    qc.setQueryData(["activity", act.id], data);
    qc.invalidateQueries({ queryKey: ["activities"] });
    setError(null);
  };
  const call = useMutation({
    mutationFn: (req: { path: string; method?: string; body?: unknown }) => api<ActivityDetail>(req.path, req),
    onSuccess: done,
    onError: (e) => setError(e.message),
  });

  const mine = act.rsvps.find((r) => r.userId === me.id);
  const alt = act.routes.length > 1;
  const open = !past && act.status === "published";
  const rsvp = (status: "in" | "out") => {
    const next = mine?.status === status ? null : status; // tapping the selected answer again clears it
    call.mutate({
      path: `/activities/${act.id}/rsvp`,
      method: "PUT",
      body: {
        status: next,
        routeLabel: next === "in" && alt ? (mine?.routeLabel ?? act.routes[0]?.label ?? null) : null,
      },
    });
  };
  const ins = act.rsvps.filter((r) => r.status === "in");
  const outs = act.rsvps.filter((r) => r.status === "out");
  // A private activity lists the people invited who haven't answered.
  const notYet = act.guests.filter((g) => !act.rsvps.some((r) => r.userId === g.userId));
  return (
    <Panel
      id="people"
      label="Who's in"
      summary={
        <>
          <div className="sumrow">
            <span className="clamp">
              <b>
                {ins.length} {past ? (act.status === "cancelled" ? "were in" : "joined") : "in"}
              </b>{" "}
              · {outs.length} out{!past && notYet.length > 0 ? ` · ${notYet.length} not yet` : ""}
            </span>
            {open && (
              <div className="seg" role="group" aria-label="Your RSVP">
                <button
                  type="button"
                  aria-pressed={mine?.status === "in"}
                  disabled={call.isPending}
                  onClick={() => rsvp("in")}
                >
                  In
                </button>
                <button
                  type="button"
                  aria-pressed={mine?.status === "out"}
                  disabled={call.isPending}
                  onClick={() => rsvp("out")}
                >
                  Out
                </button>
              </div>
            )}
          </div>
          {open && mine?.status === "in" && alt && (
            <div className="sw">
              <div className="seg" role="group" aria-label="Your route">
                {act.routes.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    aria-pressed={mine.routeLabel === r.label}
                    disabled={call.isPending}
                    onClick={() =>
                      call.mutate({
                        path: `/activities/${act.id}/rsvp`,
                        method: "PUT",
                        body: { status: "in", routeLabel: r.label },
                      })
                    }
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && ( // in the header, so a failed In / Out shows even while the panel is closed
            <p className="tiny" role="alert" style={{ color: "var(--no-fg)", margin: "6px 0 0" }}>
              {error}
            </p>
          )}
        </>
      }
    >
      <div className="people">
        <div>
          <div className="sub-h">In ({ins.length})</div>
          {ins.length > 0 && <p className="tiny muted plist-hint">Tap a name to call or text.</p>}
          <div className="plist">
            {ins.length ? (
              ins.map((p) => (
                <PersonButton key={p.userId} userId={p.userId} className={`person${p.userId === me.id ? " me" : ""}`}>
                  {p.name}
                  {alt && p.routeLabel ? <span className="muted"> · {p.routeLabel}</span> : null}
                </PersonButton>
              ))
            ) : (
              <span className="muted small">No one yet</span>
            )}
          </div>
        </div>
        {outs.length > 0 && (
          <div>
            <div className="sub-h">Out ({outs.length})</div>
            <div className="plist">
              {outs.map((p) => (
                <PersonButton key={p.userId} userId={p.userId} className={`person${p.userId === me.id ? " me" : ""}`}>
                  {p.name}
                </PersonButton>
              ))}
            </div>
          </div>
        )}
        {notYet.length > 0 && (
          <div>
            <div className="sub-h">Not answered yet ({notYet.length})</div>
            <div className="plist">
              {notYet.map((p) => (
                <PersonButton
                  key={p.userId}
                  userId={p.userId}
                  className={`person quiet${p.userId === me.id ? " me" : ""}`}
                >
                  {p.name}
                </PersonButton>
              ))}
            </div>
          </div>
        )}
        {act.private && (
          <p className="tiny muted" style={{ margin: 0 }}>
            Private: only the {act.guests.length} people invited see this.
          </p>
        )}
      </div>
    </Panel>
  );
}
