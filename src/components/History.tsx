// History: a quiet record of who created an activity and who changed it since (DESIGN.md → Activity history). Closed by
// default; shown at the end of the activity page and under the buttons when editing.
import type { ActivityDetail, HistoryEntry } from "../../shared/api.ts";
import { FORMER_MEMBER as FORMER } from "../../shared/people.ts";
import { fmtWhen } from "../../shared/time.ts";
import { Panel } from "./Panel.tsx";

const what = (h: HistoryEntry) =>
  h.action === "created"
    ? "created it"
    : h.action === "changed"
      ? h.text
        ? `changed it: ${h.text}`
        : "changed it"
      : h.action === "cancelled"
        ? "cancelled it"
        : h.action === "restored"
          ? "restored it"
          : "Cancelled: replaced by a new plan";

export function History({ act, id }: { act: ActivityDetail; id: string }) {
  const list = act.history;
  if (!list.length) return null;
  const created = list.find((h) => h.action === "created");
  const latest = list.find((h) => h.action !== "created" && h.action !== "replaced");
  const day = (iso: string) => fmtWhen(iso).replace(/,.*$/, "");
  const summary = [
    created ? `${created.who ?? FORMER} · ${day(created.at)}` : null,
    latest ? `changed by ${latest.who ?? FORMER}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Panel id={id} label="History" summary={<span className="clamp">{summary}</span>} collapsed quiet>
      <ol className="history">
        {list.map((h) => (
          <li key={`${h.at}-${h.action}`}>
            <span className="history-at">{fmtWhen(h.at)}</span>
            <span>
              {h.action === "replaced" ? null : <b>{h.who ?? FORMER}</b>} {what(h)}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
