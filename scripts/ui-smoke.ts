// Browser walk-through against the LOCAL dev server (npm run dev, local D1 migrated, npm run dev:seed).
// Run: node scripts/ui-smoke.ts [screenshot-dir]  — joins by invite, plans a ride and a pickleball session, RSVPs, posts,
// checks settings.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { dayLabel, dow, nyNow, weekendDates } from "../shared/time.ts";

const BASE = "http://localhost:8787";
const shots = process.argv[2] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const stamp = Date.now().toString(36);
// The coming Sunday: scripts/dev-seed.ts moves the sample forecast onto it.
const sunday = weekendDates(nyNow().date).find((d) => dow(d) === 0) as string;
const sundayLabel = dayLabel(sunday);
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
// Sign-in is rate-limited per client IP; locally it comes from this header (Cloudflare sets it in production).
const ip = `10.${Date.now() % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  extraHTTPHeaders: { "cf-connecting-ip": ip },
});
// Map tiles can't load in this sandbox; the app falls back to the route outline.
await ctx.route(/tile\.openstreetmap\.org|basemaps\.cartocdn\.com/, (r) => r.abort());
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
});

await page.goto(BASE);
await page.waitForURL(/\/signin/);
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
await page.waitForURL(/\/signin\?password=set/);
await page.getByLabel("Username or email").fill(`cap${stamp}`);
await page.getByLabel("Password").fill("pedal pedal pedal");
await page.getByRole("button", { name: "Sign in", exact: true }).click();
await page.waitForURL(`${BASE}/`);
await page.getByTitle("Plan an activity").waitFor();
check(await page.getByTitle("Settings").isVisible(), "joined by invite as Admin; Plan and Settings in the top bar");
await shot(page, "ride-empty");

// Plan and publish a ride
await page.getByTitle("Plan an activity").click();
await page.waitForURL("**/plan");
await page.getByRole("radio", { name: "Ride", exact: true }).click();
await page.getByRole("button", { name: /^Date \(any day\)/ }).click();
check((await page.locator(".cal-wd").first().textContent()) === "Mo", "date picker weeks start on Monday");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: sundayLabel }).click();
await page.getByRole("radio", { name: /SUNY Purchase/ }).click();
check(await page.getByText(/feels/).first().isVisible(), "spot list shows the weather window");
await page.getByLabel("RideWithGPS route").fill("Katonah");
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
await page.waitForURL("**/a/*");
const rideUrl = page.url();
for (const p of ["Meet", "Route", "Weather", "Notes", "Who's in"])
  check(await page.getByRole("button", { name: p, exact: true }).isVisible(), `ride page: ${p} panel`);
for (const t of ["Directions", "Calendar", "Share"])
  check(await page.getByRole("button", { name: t, exact: true }).isVisible(), `action row: ${t}`);
check(await page.getByRole("link", { name: "Open in RideWithGPS" }).isVisible(), "action row: RideWithGPS tile");
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
await page.getByRole("button", { name: "Who's in", exact: true }).click();
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
// Members can change their own name
await page.getByRole("button", { name: "Edit name" }).click();
await page.getByLabel("Your name").fill("Captain Renamed");
await shot(page, "edit-name");
await page.getByRole("button", { name: "Save" }).click();
await page.locator(".who-name b", { hasText: "Captain Renamed" }).waitFor();
check(await page.getByRole("button", { name: "Edit name" }).isVisible(), "a member changes their own name");
// New-activity notifications per sport: turning one off is saved and shows as off
const swim = page.getByRole("group", { name: "Tell me about new" }).getByRole("button", { name: "Swim" });
await swim.click();
for (let i = 0; i < 50 && (await swim.getAttribute("aria-pressed")) !== "false"; i++) await page.waitForTimeout(100);
check((await swim.getAttribute("aria-pressed")) === "false", "a sport's new-activity notifications turn off");
await swim.click();
await page.getByRole("button", { name: "Get my calendar link" }).click();
await page.getByRole("button", { name: "Copy link" }).waitFor();
check(
  await page.getByRole("link", { name: "Apple Calendar" }).first().isVisible(),
  "calendar link made from the account menu",
);
await page.keyboard.press("Escape");

// Edit: change the meet time → "Updated" note
await page.getByLabel("Edit", { exact: true }).click();
await page.waitForURL("**/plan?edit=*");
await page.getByText(`Editing the ${sundayLabel} ride`).waitFor();
await page.getByLabel("Meet time").fill("09:00");
await page.getByRole("button", { name: "Update ride" }).click();
await page.waitForURL(rideUrl);
check(
  await page
    .getByText(/meet 8:30 AM → 9:00 AM/)
    .first()
    .isVisible(),
  "update shows what changed",
);

// Plan an indoor pickleball session the same day: no route, no weather
await page.getByTitle("Plan an activity").click();
await page.waitForURL("**/plan");
await page.getByRole("radio", { name: "Pickleball", exact: true }).click();
await page.getByRole("button", { name: "Indoor", exact: true }).click();
await page.getByLabel("Title (optional)").fill(`Doubles ${stamp}`);
await page.getByLabel("Details (optional)").fill("2 courts");
await page.getByRole("button", { name: sundayLabel }).click();
await page.getByRole("radio", { name: /SUNY Purchase/ }).click();
await page.getByRole("button", { name: /^(Publish|Replace pickleball)$/ }).click();
await page.waitForURL("**/a/*");
check(
  await page.getByRole("heading", { name: `Doubles ${stamp}` }).isVisible(),
  "pickleball page: title in the header",
);
check(
  !(await page.getByRole("button", { name: "Weather", exact: true }).count()),
  "indoor activity has no Weather panel",
);
await page.getByLabel("BBT home").click();
await page.getByRole("link", { name: new RegExp(`Doubles ${stamp}`) }).waitFor();
check(await page.getByRole("button", { name: "Pickleball", exact: true }).isVisible(), "home shows sport filters");
await page.getByRole("button", { name: "Pickleball", exact: true }).click();
check(!(await page.getByRole("link", { name: /Katonah/ }).count()), "the filter hides other sports");
await shot(page, "home");

// Settings
await page.getByTitle("Settings").click();
await page.getByRole("button", { name: "Users", exact: true }).click();
await page.getByLabel("Invite by email").fill(`rider-${stamp}@example.test`);
await page.getByRole("button", { name: "Invite" }).click();
await page.locator(".notice input").waitFor();
check((await page.locator(".notice input").inputValue()).includes("/invite/"), "invite link shown to the Admin");

// Places: add, then edit the notes
await page.getByRole("button", { name: "Places", exact: true }).click();
await page.getByRole("button", { name: "Add a place" }).click();
await page.getByLabel("Name").fill(`Lot ${stamp}`);
await page.getByLabel("Google Maps link").fill("41.0454, -73.6973");
await page.getByLabel("Notes (optional)").fill("North lot.");
await page.getByRole("button", { name: "Add place" }).click();
const newRow = page.locator(".spot-row", { hasText: `Lot ${stamp}` });
await newRow.waitFor();
check(
  (await newRow.getByRole("link", { name: "Open in Maps" }).getAttribute("href"))?.includes("41.0454"),
  "new spot listed with an Open in Maps link",
);
await newRow.getByRole("button", { name: "Edit" }).click();
await page.getByLabel("Notes (optional)").fill("South lot.");
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
await page.goto(rideUrl);
await page.getByRole("button", { name: "Weather", exact: true }).waitFor();
await shot(page, "ride-desktop-dark");
await page.goto(`${BASE}/past`);
await page.getByLabel("Search past activities").waitFor();
check(true, "past activities page");

// iPhone browser: the Home Screen install hint, which "Not now" hides
check(!(await page.getByRole("region", { name: "Add BBT to your Home Screen" }).count()), "no install hint elsewhere");
const iphone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  extraHTTPHeaders: { "cf-connecting-ip": ip },
  storageState: await ctx.storageState(),
});
await iphone.route(/tile\.openstreetmap\.org|basemaps\.cartocdn\.com/, (r) => r.abort());
const ipage = await iphone.newPage();
ipage.on("pageerror", (e) => errors.push(`pageerror (iPhone): ${e.message}`));
await ipage.goto(BASE);
const hint = ipage.getByRole("region", { name: "Add BBT to your Home Screen" });
await hint.waitFor();
check(await hint.getByText("Add to Home Screen").isVisible(), "iPhone browser shows the install hint");
await shot(ipage, "iphone-install-hint");
await ipage.getByLabel("Account menu").click();
check(
  await ipage.getByRole("link", { name: "Install on iPhone" }).isVisible(),
  "iPhone account menu offers Install on iPhone",
);
await ipage.keyboard.press("Escape");
await hint.getByRole("button", { name: "Not now" }).click();
await ipage.reload();
// The hint and the Welcome sheet need the account; wait for it (and the async notification check) before looking.
const settled = async () => {
  await ipage.getByRole("button", { name: "Account menu" }).waitFor();
  await ipage.waitForTimeout(800);
};
await settled();
check(!(await hint.count()), "Not now hides the install hint");
// iPhone Home Screen app: a Welcome sheet on first open (notifications, calendar), then never again
await ipage.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
await ipage.goto(BASE);
const welcome = ipage.getByRole("dialog", { name: "Welcome to BBT" });
await welcome.waitFor();
check(
  (await welcome.getByRole("button", { name: "Turn on notifications" }).isVisible()) && !(await hint.count()),
  "Home Screen app welcomes with notifications, without the install hint",
);
await shot(ipage, "iphone-welcome");
await welcome.getByRole("button", { name: "Done" }).click();
await ipage.reload();
await settled();
check(!(await welcome.count()), "the Welcome sheet shows once");
await iphone.close();

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
