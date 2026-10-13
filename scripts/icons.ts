// Renders the app icons (white BBT bike logo on BBT Light Blue, DESIGN.md → v2) with the preinstalled Chromium:
// the web app's icons (also used on notifications) and the Android launcher icons (the splash screen reuses them).
// Run once when the brand changes: node scripts/icons.ts. The favicon stays the "bbt" wordmark, which reads at 16px.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const root = join(import.meta.dirname, "..");
const BLUE = "#0077D1";
const logo = (widthPct: number) =>
  readFileSync(join(root, "brand/web/bbt-logo.svg"), "utf8").replace(
    "<svg ",
    `<svg style="width:${widthPct}%;color:#fff;display:block" `,
  );
const res = (p: string) => join(root, "android/app/src/main/res", p);

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(path: string, w: number, h: number, body: string, background = BLUE, radius = "0") {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<body style="margin:0;width:${w}px;height:${h}px;display:grid;place-items:center;background:transparent">
       <div style="width:100%;height:100%;display:grid;place-items:center;background:${background};border-radius:${radius}">${body}</div>
     </body>`,
  );
  await page.screenshot({ path, omitBackground: true });
}

// Web app (Home Screen, notifications)
for (const size of [180, 192, 512]) await render(join(root, `public/icons/icon-${size}.png`), size, size, logo(76));
// Android Chrome's installed icon may be cut to a circle: keep the logo inside the central 80% (the maskable safe zone).
await render(join(root, "public/icons/icon-maskable-512.png"), 512, 512, logo(62));

// Android launcher: legacy square and round icons, and the adaptive icon's foreground (logo inside the 66/108 safe zone)
const densities: [string, number][] = [
  ["mdpi", 1],
  ["hdpi", 1.5],
  ["xhdpi", 2],
  ["xxhdpi", 3],
  ["xxxhdpi", 4],
];
for (const [d, k] of densities) {
  const icon = 48 * k;
  await render(res(`mipmap-${d}/ic_launcher.png`), icon, icon, logo(76), BLUE, `${icon * 0.16}px`);
  await render(res(`mipmap-${d}/ic_launcher_round.png`), icon, icon, logo(72), BLUE, "50%");
  await render(res(`mipmap-${d}/ic_launcher_foreground.png`), 108 * k, 108 * k, logo(56), "transparent");
}
writeFileSync(
  res("values/ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BLUE}</color>\n</resources>\n`,
);

await browser.close();
console.log("Wrote public/icons and the Android launcher icons");
