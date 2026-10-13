// One activity, upcoming or past (read-only): header card, action row, warnings and panels (DESIGN.md → Rides, v2).
import { useState } from "react";
import type { ActivityDetail, Me } from "../../shared/api.ts";
import { fmtStamp, nyNow } from "../../shared/time.ts";
import { ActionRow, ActivityBody, ActivityHeader } from "../components/ActivityBody.tsx";
import { LevelIcon } from "../components/icons.tsx";
import { WhoIsIn } from "../components/WhoIsIn.tsx";
import { useActivityModel } from "../lib/activityModel.ts";
import { useActivity } from "../lib/data.ts";
import { Link, navigate } from "../lib/router.tsx";

function View({ act, me }: { act: ActivityDetail; me: Me }) {
  const [routeIndex, setRouteIndex] = useState(0);
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
      <ActivityHeader act={act} m={m} onEdit={editor && !past ? () => navigate(`/plan?edit=${act.id}`) : undefined} />
      {act.status === "cancelled" ? (
        <div className="warn lv2 big">
          <LevelIcon level={2} />
          <div>
            <b>Cancelled</b>
            <span>{act.messages.findLast((x) => x.kind === "cancel")?.body ?? ""} See Who’s in for messages.</span>
          </div>
        </div>
      ) : (
        !past &&
        last && (
          <div className="notice">
            <b>Updated {fmtStamp(last.at)}</b> · {last.text}
          </div>
        )
      )}
      <ActionRow act={act} m={m} />
      <ActivityBody
        act={act}
        model={m}
        mode={past ? "past" : "upcoming"}
        routeIndex={routeIndex}
        onRouteIndex={setRouteIndex}
        people={<WhoIsIn act={act} me={me} past={past} />}
      />
    </>
  );
}

export function ActivityPage({ id, me }: { id: string; me: Me }) {
  const q = useActivity(id);
  if (q.isError)
    return (
      <p className="small" role="alert">
        Couldn't load this activity: {q.error.message}
      </p>
    );
  return q.data ? <View key={q.data.id} act={q.data} me={me} /> : <p className="muted small">Loading…</p>;
}
