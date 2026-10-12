// Routes and the sign-in gate. Public: /signin, /invite/:token, /reset/:token (and the static /privacy page).
import { lazy, type ReactNode, Suspense, useEffect } from "react";
import { TopBar } from "./components/TopBar.tsx";
import { ApiError } from "./lib/api.ts";
import { useMe } from "./lib/data.ts";
import { navigate, useLocation } from "./lib/router.tsx";
import { LinkPage } from "./pages/LinkPage.tsx";
import { PastList, PastRide } from "./pages/PastPage.tsx";
import { RidePage } from "./pages/RidePage.tsx";
import { SignIn } from "./pages/SignIn.tsx";

// Editor and admin screens load on demand; most riders never open them.
const PlanPage = lazy(() => import("./pages/PlanPage.tsx").then((m) => ({ default: m.PlanPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage.tsx").then((m) => ({ default: m.SettingsPage })));

export function App() {
  const { path, parts, query } = useLocation();
  const [page, arg] = parts;
  const isPublic = page === "signin" || page === "invite" || page === "reset";
  const me = useMe();
  const signedOut = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    // Come back to the shared link (a ride, an edit) after signing in.
    const here = window.location.pathname + window.location.search;
    if (signedOut && !isPublic) navigate(here === "/" ? "/signin" : `/signin?next=${encodeURIComponent(here)}`, true);
  }, [signedOut, isPublic]);

  if (isPublic) {
    return (
      <>
        <TopBar me={null} />
        {page === "signin" ? <SignIn /> : <LinkPage kind={page === "invite" ? "invite" : "reset"} token={arg ?? ""} />}
      </>
    );
  }

  const user = me.data;
  let content: ReactNode;
  if (me.isPending || signedOut) content = <p className="muted small">Loading…</p>;
  else if (!user) content = <p role="alert">Couldn't load your account: {me.error?.message}</p>;
  else if (page === "plan")
    content =
      user.role === "view" ? <Restricted text="Planning is for editors." /> : <PlanPage key={`${path}?${query}`} />;
  else if (page === "settings")
    content = user.role === "admin" ? <SettingsPage me={user} /> : <Restricted text="Settings are for admins." />;
  else if (page === "past") content = arg ? <PastRide id={arg} me={user} /> : <PastList />;
  else content = <RidePage me={user} date={page === "ride" ? arg : undefined} />;

  return (
    <>
      <TopBar me={user ?? null} />
      <main>
        <Suspense fallback={<p className="muted small">Loading…</p>}>{content}</Suspense>
      </main>
    </>
  );
}

const Restricted = ({ text }: { text: string }) => (
  <section className="panel empty">
    <p>
      <b>{text}</b>
    </p>
    <p className="muted small">Ask a team admin if you need access.</p>
  </section>
);
