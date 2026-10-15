// Its creator and Admins: delete an activity for good (DESIGN.md → Deleting an activity). Cancel stays the everyday choice.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type ActivityDetail, activityName } from "../../shared/api.ts";
import { nyNow } from "../../shared/time.ts";
import { api } from "../lib/api.ts";
import { navigate } from "../lib/router.tsx";
import { Sheet } from "./Sheet.tsx";

export function DeleteActivity({
  act,
  sportName,
  meId,
  onDeleted,
  onCancelInstead,
}: {
  act: ActivityDetail;
  sportName: string;
  meId: string;
  onDeleted: () => Promise<unknown>; // drops the Plan form's draft, so a save in flight can't bring it back
  onCancelInstead: () => void; // offered while it's published: cancelling keeps it on the list and tells everyone
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: () => api(`/activities/${act.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      navigate("/", true); // Back shouldn't return to editing something that's gone
      await onDeleted();
      qc.removeQueries({ queryKey: ["activity", act.id] });
      await qc.invalidateQueries({ queryKey: ["activities"] });
    },
  });
  // The server tells the people going to an upcoming, published one (not the Admin deleting it)
  const told =
    act.status === "published" && act.date >= nyNow().date
      ? act.rsvps.filter((r) => r.status === "in" && r.userId !== meId).length
      : 0;
  const msgs = act.messages.filter((m) => m.kind === "user" && !m.deleted).length;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return (
    <div className="danger-zone">
      <button type="button" className="btn btn-danger-outline" onClick={() => setOpen(true)}>
        Delete {sportName}
      </button>
      <p className="tiny muted">Its creator and Admins only. Removes it for everyone, with its RSVPs and messages.</p>
      {open && (
        <Sheet label={`Delete ${activityName(act)}`} onClose={() => setOpen(false)}>
          <div className="confirm">
            <h2>Delete “{activityName(act)}”?</h2>
            <p>
              This removes it, its <b>{plural(act.rsvps.length, "RSVP")}</b> and <b>{plural(msgs, "message")}</b> for
              everyone. It can't be undone.
            </p>
            <p className="muted small">
              {told ? `${told === 1 ? "The 1 person" : `The ${told} people`} going get a “Deleted” notification. ` : ""}
              The audit log keeps a record.
            </p>
            {del.error && (
              <p className="small" role="alert" style={{ color: "var(--no-fg)" }}>
                {del.error.message}
              </p>
            )}
            <div className="confirm-btns">
              <button type="button" className="btn btn-danger" disabled={del.isPending} onClick={() => del.mutate()}>
                Delete for everyone
              </button>
              {act.status === "published" && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setOpen(false);
                    onCancelInstead();
                  }}
                >
                  Cancel it instead
                </button>
              )}
              <button type="button" className="linkbtn" onClick={() => setOpen(false)}>
                Keep it
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
