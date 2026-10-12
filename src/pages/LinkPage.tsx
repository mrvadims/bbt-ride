// Invite (/invite/:token) and reset (/reset/:token) links: continue with Google, or set a password.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api } from "../lib/api.ts";
import { navigate } from "../lib/router.tsx";
import { continueWithGoogle, GoogleMark } from "./SignIn.tsx";

export function LinkPage({ kind, token }: { kind: "invite" | "reset"; token: string }) {
  const qc = useQueryClient();
  const link = useQuery({
    queryKey: ["link", token],
    queryFn: () => api<{ kind: string; email: string }>(`/links/${token}`),
    retry: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password"));
    if (password !== String(f.get("confirm"))) return setError("The passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      const body =
        kind === "invite" ? { name: f.get("name"), username: f.get("username") || undefined, password } : { password };
      await api(`/links/${token}`, { body });
      await qc.invalidateQueries();
      navigate("/", true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const valid = link.data && link.data.kind === kind;
  return (
    <main>
      <section className="panel signin">
        <div className="signin-b">
          <h1 className="sub-h" style={{ justifyContent: "center", fontSize: 18 }}>
            {kind === "invite" ? "Join BBT Ride" : "Choose a new password"}
          </h1>
          {link.isPending && <p className="muted small">Checking your link…</p>}
          {link.isError && (
            <p className="small" role="alert">
              {link.error.message}
            </p>
          )}
          {valid && (
            <>
              <p className="small muted" style={{ margin: 0, textAlign: "center" }}>
                {kind === "invite" ? "Invited as" : "Account"} <b>{link.data.email}</b>
              </p>
              {kind === "invite" && (
                <>
                  <button type="button" className="btn btn-outline gbtn" onClick={() => continueWithGoogle()}>
                    <GoogleMark />
                    Continue with Google
                  </button>
                  <p className="tiny muted" style={{ margin: 0, textAlign: "center" }}>
                    Use the Google account for {link.data.email}.
                  </p>
                  <div className="or">
                    <span>or set a password</span>
                  </div>
                </>
              )}
              <form className="sec-b" style={{ padding: 0 }} onSubmit={submit}>
                {kind === "invite" && (
                  <>
                    <label className="field">
                      Your name (shown to the team)
                      <input name="name" autoComplete="name" required maxLength={80} />
                    </label>
                    <label className="field">
                      Username (optional; you can always sign in with your email)
                      <input name="username" autoComplete="username" pattern="[A-Za-z0-9_.]{3,30}" maxLength={30} />
                    </label>
                  </>
                )}
                <label className="field">
                  Password (at least 10 characters)
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    maxLength={128}
                    required
                  />
                </label>
                <label className="field">
                  Password again
                  <input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    maxLength={128}
                    required
                  />
                </label>
                {error && (
                  <p className="small" role="alert" style={{ color: "var(--no-fg)", margin: 0 }}>
                    {error}
                  </p>
                )}
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {kind === "invite" ? "Create account" : "Save password"}
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
