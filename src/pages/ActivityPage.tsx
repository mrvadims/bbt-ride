// One activity, upcoming or past (read-only): header card, action row, warnings and panels (DESIGN.md → Rides, v2).
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { ActivityDetail, Me } from "../../shared/api.ts";
import { fmtStamp, nyNow } from "../../shared/time.ts";
import { ActionRow, ActivityBody, ActivityHeader } from "../components/ActivityBody.tsx";
import { History } from "../components/History.tsx";
import { LevelIcon } from "../components/icons.tsx";
import { MessagesPanel } from "../components/Messages.tsx";
import { WhoIsIn } from "../components/WhoIsIn.tsx";
import { useActivityModel } from "../lib/activityModel.ts";
import { api } from "../lib/api.ts";
import { useActivity } from "../lib/data.ts";
import { Link, navigate } from "../lib/router.tsx";

function View({ act, me, since }: { act: ActivityDetail; me: Me; since?: string | null }) {
  const [routeIndex, setRouteIndex] = useState(0);
  const qc = useQueryClient();
  const m = useActivityModel(act, routeIndex);
  const past = act.date < nyNow().date;
  const editor = me.role !== "view";
  if (!m || m.loading) return <p className="muted small">Loading…</p>;
  const last = act.lastUpdate;
  return (
    <>
      {past && (
        <div className="pasthead">
          <Link className="small" href="/past">
            ← Past activities
          </Link>
          {editor && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate(`/plan?reuse=${act.id}`)}>
              Reuse this plan
            </button>
          )}
        </div>
      )}
      <ActivityHeader
        act={act}
        m={m}
        onEdit={editor && !past ? () => navigate(`/plan?edit=${act.id}`) : undefined}
        note={
          act.status !== "cancelled" &&
          !past &&
          last && (
            <>
              <b>
                {typeof since === "string" && last.at > since
                  ? "Changed since you last looked"
                  : `Updated ${fmtStamp(last.at)}`}
              </b>{" "}
              · {last.text}
            </>
          )
        }
      />
      {act.status === "cancelled" && (
        <div className="warn lv2 big">
          <LevelIcon level={2} />
          <div>
            <b>Cancelled</b>
            <span>{act.messages.findLast((x) => x.kind === "cancel")?.body ?? ""} See Messages below.</span>
          </div>
        </div>
      )}
      {act.fromPoll && (
        <p className="small from-poll">
          From the date poll <Link href={`/polls/${act.fromPoll.id}`}>{act.fromPoll.title}</Link>
          {act.fromPoll.messages ? ` · ${act.fromPoll.messages} message${act.fromPoll.messages === 1 ? "" : "s"}` : ""}
        </p>
      )}
      <ActionRow act={act} m={m} />
      <ActivityBody
        act={act}
        model={m}
        mode={past ? "past" : "upcoming"}
        routeIndex={routeIndex}
        onRouteIndex={setRouteIndex}
        people={<WhoIsIn act={act} me={me} past={past} />}
        messages={
          <MessagesPanel
            id="messages"
            messages={act.messages}
            me={me}
            canPost={!past && act.status === "published"}
            past={past}
            postPath={`/activities/${act.id}/messages`}
            onData={(data) => {
              qc.setQueryData(["activity", act.id], data as ActivityDetail);
              qc.invalidateQueries({ queryKey: ["activities"] });
            }}
            only={act.private ? act.guests.map((g) => g.userId) : undefined}
            group={act.private}
            since={since}
            notify={act.notify}
            notifyPath={`/activities/${act.id}/notify`}
          />
        }
        history={<History act={act} id="history" />}
      />
    </>
  );
}

export function ActivityPage({ id, me }: { id: string; me: Me }) {
  const q = useActivity(id);
  // Opening it records the visit (once per page, even when React runs effects twice in development); the reply says
  // when the viewer last caught up, for the "N new" divider. Home's markers then refresh.
  const [since, setSince] = useState<string | null | undefined>(undefined);
  const qc = useQueryClient();
  const recorded = useRef("");
  useEffect(() => {
    if (recorded.current === id) return;
    recorded.current = id;
    api<{ seenBefore: string | null }>(`/activities/${id}/seen`, { method: "POST", body: {} })
      .then((r) => {
        setSince(r.seenBefore);
        qc.invalidateQueries({ queryKey: ["activities"] });
      })
      .catch(() => undefined);
  }, [id, qc]);
  if (q.isError && !q.data)
    // a failed background refresh keeps showing what loaded (and any half-typed message)
    return (
      <p className="small" role="alert">
        Couldn't load this activity: {q.error.message}
      </p>
    );
  return q.data ? <View key={q.data.id} act={q.data} me={me} since={since} /> : <p className="muted small">Loading…</p>;
}
