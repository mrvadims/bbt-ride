// Renders every ```mermaid block in the repo's Markdown docs in Chromium; exits 1 if any fails.
// Usage: node mermaid-check.mjs <path to mermaid.min.js>   (called by gates.sh)
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const files = ["ARCHITECTURE.md", "DESIGN.md", "README.md"];
const blocks = files.flatMap((f) => {
  try {
    return [...readFileSync(f, "utf8").matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m, i) => ({ f, i, code: m[1] }));
  } catch {
    return [];
  }
});
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<html><body></body></html>");
await page.addScriptTag({ path: process.argv[2] });
let failed = 0;
for (const b of blocks) {
  const r = await page.evaluate(async (code) => {
    try {
      mermaid.initialize({ startOnLoad: false });
      await mermaid.render(`d${Math.floor(Math.random() * 1e9)}`, code);
      return "ok";
    } catch (e) {
      return `ERR ${e.message}`;
    }
  }, b.code);
  if (r !== "ok") failed++;
  console.log(`${b.f} diagram ${b.i + 1}: ${r}`);
}
await browser.close();
console.log(`${blocks.length - failed} of ${blocks.length} diagrams render`);
process.exit(failed ? 1 : 0);
