// Browser walk-through against the LOCAL dev server (npm run dev, local D1 migrated, npm run dev:seed).
// Run: node scripts/ui-smoke.ts [screenshot-dir]  — joins by invite, plans and publishes a ride, RSVPs, posts, checks settings.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = "http://localhost:8787";
const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const stamp = Date.now().toString(36);
const errors: string[] = [];
let failures = 0;
const check = (cond: unknown, what: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
  if (!cond) failures++;
};
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};

// An Admin invite, seeded directly (production's first Admin signs in with Google as BOOTSTRAP_ADMIN_EMAIL).
const token = `ui-${stamp}`;
const hash = createHash("sha256").update(token).digest("hex");
execFileSync(
  "npx",
  [
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--local",
    "--command",
    `insert into links (token_hash, kind, email, role, created_at, expires_at) values ('${hash}', 'invite', 'captain-${stamp}@example.test', 'admin', '${new Date().toISOString()}', '${new Date(Date.now() + 3600e3).toISOString()}')`,
  ],
  { stdio: "pipe" },
);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
// Map tiles can't load in this sandbox; the app falls back to the route outline.
await ctx.route(/tile\.openstreetmap\.org|basemaps\.cartocdn\.com/, (r) => r.abort());
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
});

await page.goto(BASE);
await page.waitForURL("**/signin");
check(
  await page.getByRole("button", { name: "Continue with Google" }).isVisible(),
  "signed out → sign-in page with Google",
);
await shot(page, "signin");

await page.goto(`${BASE}/invite/${token}`);
await page.getByLabel("Your name").fill("Captain Test");
await page.getByLabel("Username").fill(`cap${stamp}`);
await page.getByLabel("Password (at least").fill("pedal pedal pedal");
await page.getByLabel("Password again").fill("pedal pedal pedal");
await shot(page, "invite");
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL(`${BASE}/`);
await page.getByTitle("Plan a ride").waitFor();
check(await page.getByTitle("Settings").isVisible(), "joined by invite as Admin; Plan and Settings in the top bar");
await shot(page, "ride-empty");

// Plan and publish
await page.getByTitle("Plan a ride").click();
await page.waitForURL("**/plan");
await page.getByRole("button", { name: /Sun, Oct 11/ }).click();
await page.getByRole("radio", { name: /SUNY Purchase/ }).click();
check(await page.getByText(/feels/).first().isVisible(), "spot list shows the weather window");
await page.getByPlaceholder("e.g. Katonah").fill("Katonah");
await page
  .getByRole("option", { name: /Katonah/ })
  .first()
  .click();
const publishBtn = page.getByRole("button", { name: /^(Publish|Replace ride)$/ }); // Replace on re-runs
await publishBtn.waitFor();
check(await page.getByText("Tazza Cafe").first().isVisible(), "coffee stop suggested from the route's POIs");
await page.getByLabel("Notes").fill("Regroup at the top of every climb.");
await shot(page, "plan");
await publishBtn.click();
await page.waitForURL("**/ride/2026-10-11");
for (const p of ["Meet", "Route", "Weather", "Notes", "Riders"])
  check(await page.getByRole("button", { name: p, exact: true }).isVisible(), `ride page: ${p} panel`);
check(
  await page
    .getByText(/feels .*wind/)
    .first()
    .isVisible(),
  "weather summary in the Weather header",
);

// RSVP and messages
await page.getByRole("button", { name: "In", exact: true }).click();
await page.getByText("1 in").waitFor();
check(true, "RSVP In updates the count");
await page.getByRole("button", { name: "Riders", exact: true }).click();
await page.getByPlaceholder("Message the team").fill("See you at 8:30!");
await page.getByRole("button", { name: "Send" }).click();
await page.getByText("See you at 8:30!").waitFor();
check(true, "message posted to the thread");
await shot(page, "ride");

// Units: metric display
await page.getByLabel("Account menu").click();
await page.getByRole("button", { name: "°C · km" }).click();
await page.keyboard.press("Escape");
check(await page.getByText(/\d km/).first().isVisible(), "metric display after switching units");
await page.getByLabel("Account menu").click();
await page.getByRole("button", { name: "°F · mi" }).click();
await page.keyboard.press("Escape");

// Edit: change roll-out → "Updated" note
await page.getByLabel("Edit this ride").click();
await page.waitForURL("**/plan?edit=*");
await page.getByText(/Editing the Sun, Oct 11 ride/).waitFor();
await page.getByLabel("Roll-out").fill("09:00");
await page.getByRole("button", { name: "Update ride" }).click();
await page.waitForURL("**/ride/2026-10-11");
check(
  await page
    .getByText(/roll-out 8:30 AM → 9:00 AM/)
    .first()
    .isVisible(),
  "update shows what changed",
);

// Settings
await page.getByTitle("Settings").click();
await page.getByRole("button", { name: "Users", exact: true }).click();
await page.getByLabel("Invite by email").fill(`rider-${stamp}@example.test`);
await page.getByRole("button", { name: "Invite" }).click();
await page.locator(".notice input").waitFor();
check((await page.locator(".notice input").inputValue()).includes("/invite/"), "invite link shown to the Admin");

// Spots: add, then edit the parking notes
await page.getByRole("button", { name: "Spots", exact: true }).click();
await page.getByRole("button", { name: "Add a spot" }).click();
await page.getByLabel("Name").fill(`Lot ${stamp}`);
await page.getByLabel("Google Maps link").fill("41.0454, -73.6973");
await page.getByLabel("Parking notes").fill("North lot.");
await page.getByRole("button", { name: "Add spot" }).click();
const newRow = page.locator(".spot-row", { hasText: `Lot ${stamp}` });
await newRow.waitFor();
check(
  (await newRow.getByRole("link", { name: "Open in Maps" }).getAttribute("href"))?.includes("41.0454"),
  "new spot listed with an Open in Maps link",
);
await newRow.getByRole("button", { name: "Edit" }).click();
await page.getByLabel("Parking notes").fill("South lot.");
await page.getByRole("button", { name: "Save changes" }).click();
await newRow.getByText("South lot.").waitFor();
check(true, "spot edited in place");
await newRow.getByRole("button", { name: "Archive" }).click(); // only the seeded spots have sample forecasts
await page.getByText(/^Archived \(\d+\)/).waitFor();
check(true, "spot archived");
await shot(page, "settings");

// Desktop, dark
await page.setViewportSize({ width: 1280, height: 900 });
await page.emulateMedia({ colorScheme: "dark" });
await page.goto(`${BASE}/ride/2026-10-11`);
await page.getByRole("button", { name: "Weather", exact: true }).waitFor();
await shot(page, "ride-desktop-dark");
await page.goto(`${BASE}/past`);
await page.getByLabel("Search past rides").waitFor();
check(true, "past rides page");

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
