// iPhone and iPad browsers (DESIGN.md → v2, iPhone): notifications only work once BBT is on the Home Screen, so a
// short card shows the three taps. "Not now" hides it for 30 days.
import { useState } from "react";
import { ShareIcon } from "./icons.tsx";

const KEY = "bbt-install-hint-hidden-until";
const HIDE_DAYS = 30;
const hidden = () => {
  try {
    return Number(localStorage.getItem(KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
};

export function InstallHint() {
  const [show, setShow] = useState(!hidden());
  if (!show) return null;
  const notNow = () => {
    try {
      localStorage.setItem(KEY, String(Date.now() + HIDE_DAYS * 86_400_000));
    } catch {
      // shown again next visit
    }
    setShow(false);
  };
  return (
    <section className="notice install" aria-label="Add BBT to your Home Screen">
      <b>Get notifications: add BBT to your Home Screen</b>
      <ol>
        <li>
          Tap Share{" "}
          <span className="install-icon" aria-hidden="true">
            <ShareIcon />
          </span>{" "}
          in the browser's toolbar.
        </li>
        <li>
          Choose <b>Add to Home Screen</b>.
        </li>
        <li>Open BBT from your Home Screen, sign in once more, and turn on notifications.</li>
      </ol>
      <button type="button" className="linkbtn" onClick={notNow}>
        Not now
      </button>
    </section>
  );
}
