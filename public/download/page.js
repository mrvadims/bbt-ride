// "BBT on your phone": highlights the visitor's own phone, shows the Android app's version, or that it isn't built yet
// (android.json is written by the deploy).
const mine = /iPhone|iPad|iPod/.test(navigator.userAgent)
  ? "iphone"
  : /Android/.test(navigator.userAgent)
    ? "android"
    : null;
if (mine) {
  const card = document.getElementById(mine);
  card.classList.add("mine");
  card.querySelector(".tag").hidden = false;
  card.parentElement.prepend(card); // your phone first
}
fetch("/download/android.json", { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
  .then((v) => {
    document.getElementById("version").textContent =
      `Version ${v.versionName} · not in the Play Store, so Android asks once before installing.`;
  })
  .catch(() => {
    document.getElementById("download").hidden = true;
    document.getElementById("version").hidden = true;
    document.getElementById("missing").hidden = false;
  });
