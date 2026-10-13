// Sign in with Google (main) or username/email + password (DESIGN.md → Users and roles).
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { authClient } from "../lib/api.ts";
import { queryClient } from "../lib/data.ts";
import { bbt, isApp } from "../lib/native.ts";
import { navigate, useLocation } from "../lib/router.tsx";

export const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M45 24.5c0-1.6-.1-2.8-.4-4.1H24v7.7h12c-.2 2-1.6 5-4.6 7l7.1 5.5C42.6 36.7 45 31.1 45 24.5z"
    />
    <path
      fill="#34A853"
      d="M24 46c5.9 0 10.9-1.9 14.5-5.3l-7.1-5.5c-1.9 1.3-4.4 2.2-7.4 2.2-5.7 0-10.5-3.8-12.2-8.9l-7.3 5.6C8.1 41.2 15.4 46 24 46z"
    />
    <path
      fill="#FBBC05"
      d="M11.8 28.5c-.4-1.3-.7-2.7-.7-4.5s.3-3.2.7-4.5l-7.3-5.6C3 16.9 2 20.3 2 24s1 7.1 2.5 10.1l7.3-5.6z"
    />
    <path
      fill="#EA4335"
      d="M24 10.6c4.1 0 6.9 1.8 8.5 3.3l6.3-6.1C34.9 4.2 29.9 2 24 2 15.4 2 8.1 6.8 4.5 13.9l7.3 5.6c1.7-5.1 6.5-8.9 12.2-8.9z"
    />
  </svg>
);

// Better Auth redirects Google failures to /signin?error=<code>; the invite check uses message "Not invited …".
const errorText = (code: string | null) =>
  !code
    ? null
    : /forbidden|invite/i.test(code)
      ? "Not invited — ask a team admin."
      : "Google sign-in didn't complete. Try again.";

/** Where to go after signing in: the ?next= path the app was opened at, if it's one of ours. */
const nextPath = (query: URLSearchParams) => {
  const next = query.get("next") ?? "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
};

let signingIn = false; // the app's account picker is already open

export async function continueWithGoogle(next = "/") {
  if (!isApp()) {
    await authClient.signIn.social({ provider: "google", callbackURL: next, errorCallbackURL: "/signin" });
    return;
  }
  // The Android app: Google's own account picker, then Better Auth checks the ID token (Google doesn't allow its
  // sign-in page inside an app's WebView).
  if (signingIn) return;
  signingIn = true;
  const failed = (code: string) =>
    navigate(
      `/signin?error=${encodeURIComponent(code)}${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`,
      true,
    );
  try {
    let idToken: string;
    try {
      idToken = (await bbt.googleSignIn()).idToken;
    } catch (e) {
      if ((e as { code?: string }).code !== "CANCELLED") failed("google");
      return;
    }
    const res = await authClient.signIn.social({ provider: "google", idToken: { token: idToken }, callbackURL: next });
    if (res.error) {
      failed(res.error.message ?? "google");
      return;
    }
    await queryClient.invalidateQueries();
    navigate(next, true);
  } finally {
    signingIn = false;
  }
}

export function SignIn() {
  const { query } = useLocation();
  const qc = useQueryClient();
  const [error, setError] = useState(errorText(query.get("error")));
  const errorCode = query.get("error");
  useEffect(() => {
    if (errorCode) setError(errorText(errorCode)); // the app's Google sign-in reports back without leaving the page
  }, [errorCode]);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const id = String(f.get("user") ?? "").trim();
    const password = String(f.get("password") ?? "");
    setBusy(true);
    setError(null);
    const res = id.includes("@")
      ? await authClient.signIn.email({ email: id, password })
      : await authClient.signIn.username({ username: id, password });
    setBusy(false);
    if (res.error) {
      setError(
        res.error.status === 429
          ? "Too many attempts. Wait 15 minutes and try again."
          : "Wrong username, email or password.",
      );
      return;
    }
    await qc.invalidateQueries();
    navigate(nextPath(query), true);
  };

  return (
    <main>
      <h1 className="sr">Sign in</h1>
      <section className="panel signin">
        <div className="signin-b">
          <div className="sub-h" style={{ justifyContent: "center", fontSize: 18 }}>
            Sign in to BBT
          </div>
          {error && (
            <p className="small" role="alert" style={{ color: "var(--no-fg)", textAlign: "center", margin: 0 }}>
              {error}
            </p>
          )}
          {!error && query.get("password") === "set" && (
            <p className="small" role="status" style={{ textAlign: "center", margin: 0 }}>
              Password saved. Sign in with your email or username and the new password.
            </p>
          )}
          <button type="button" className="btn btn-outline gbtn" onClick={() => continueWithGoogle(nextPath(query))}>
            <GoogleMark />
            Continue with Google
          </button>
          <div className="or">
            <span>or</span>
          </div>
          <form className="sec-b" style={{ padding: 0 }} onSubmit={submit}>
            <label className="field">
              Username or email
              <input name="user" autoComplete="username" required />
            </label>
            <label className="field">
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Sign in
            </button>
          </form>
          <p className="tiny muted" style={{ margin: "10px 0 0", textAlign: "center" }}>
            Forgot your password? Ask a team admin for a reset link.
            <br />
            Not on the team list yet? Ask a team admin for an invite.
            <br />
            <a href="/privacy">Privacy</a>
          </p>
        </div>
      </section>
    </main>
  );
}
