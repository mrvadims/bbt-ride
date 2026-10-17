// Plan's two tabs (DESIGN.md → Date polls): plan an activity, or first ask the team which date works.
import { Link } from "../lib/router.tsx";

export function PlanTabs({ current }: { current: "plan" | "poll" }) {
  return (
    <nav className="plan-tabs" aria-label="Plan">
      <Link
        href="/plan"
        className={current === "plan" ? "on" : undefined}
        aria-current={current === "plan" ? "page" : undefined}
      >
        Plan an activity
      </Link>
      <Link
        href="/polls/new"
        className={current === "poll" ? "on" : undefined}
        aria-current={current === "poll" ? "page" : undefined}
      >
        Date poll
      </Link>
    </nav>
  );
}
