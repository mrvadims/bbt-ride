// The download page: shows the app's version, or that it isn't built yet (android.json is written by the deploy).
fetch("/download/android.json", { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
  .then((v) => {
    document.getElementById("version").textContent =
      `Version ${v.versionName} · the team app, with notifications on your phone.`;
  })
  .catch(() => {
    document.getElementById("download").hidden = true;
    document.getElementById("missing").hidden = false;
  });
