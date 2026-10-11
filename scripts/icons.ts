// Renders the PWA icons (white "bbt" wordmark on BBT Light Blue) with the preinstalled Chromium.
// Run once when the brand changes: node scripts/icons.ts → public/icons/*.png and public/favicon.svg.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const root = join(import.meta.dirname, "..");
const mark = readFileSync(join(root, "brand/web/bbt-wordmark.svg"), "utf8").replace(
  "<svg ",
  '<svg style="width:70%;color:#fff" ',
);
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [180, 192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0;width:${size}px;height:${size}px;background:#0077D1;display:grid;place-items:center">${mark}</body>`,
  );
  await page.screenshot({ path: join(root, `public/icons/icon-${size}.png`) });
}
await browser.close();
// Favicon: the same mark as a small SVG.
writeFileSync(
  join(root, "public/favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0077D1"/><g transform="translate(8 19) scale(1.5)" fill="#fff">${
    readFileSync(join(root, "brand/web/bbt-wordmark.svg"), "utf8")
      .match(/<path[\s\S]*<\/path>|<path[^>]*\/>/g)
      ?.join("") ?? ""
  }</g></svg>`,
);
console.log("Wrote public/icons/icon-{180,192,512}.png and public/favicon.svg");
