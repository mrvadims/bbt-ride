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
const sql = (command: string) =>
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", command], { stdio: "pipe" });
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
await page.getByLabel("First and last name").fill("Captain Test");
await page.getByLabel("Username").fill(`cap${stamp}`);
await page.getByLabel("Mobile phone").fill("(914) 555-0142");
await page.getByLabel("Name", { exact: true }).fill("Chris Captain");
await page.getByLabel("Phone", { exact: true }).fill("914 555 0190");
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
await page.getByRole("radiogroup", { name: "Sport" }).getByRole("radio", { name: "Triathlon" }).waitFor();
check(true, "Plan offers Triathlon");
// Other offers an icon: three dots until an editor picks one
await page.getByRole("radiogroup", { name: "Sport" }).getByRole("radio", { name: "Other", exact: true }).click();
const icons = page.getByRole("radiogroup", { name: "Icon" });
check(
  (await icons.getByRole("radio", { name: "Other" }).getAttribute("aria-checked")) === "true",
  "Other starts with the dots icon",
);
await icons.getByRole("radio", { name: "Kayak" }).click();
check(
  (await icons.getByRole("radio", { name: "Kayak" }).getAttribute("aria-checked")) === "true",
  "an editor picks another icon",
);
await shot(page, "plan-other");
await page.getByRole("radiogroup", { name: "Sport" }).getByRole("radio", { name: "Ride", exact: true }).click();
await page.getByRole("button", { name: /^Date: / }).click();
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
const publishBtn = page.getByRole("button", { name: /^(Publish|Publish another ride)$/ }); // "another" on re-runs
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

await page.getByRole("button", { name: "History", exact: true }).click();
check(await page.getByText("created it").isVisible(), "History panel lists who created it");
await shot(page, "history");
await page.getByRole("button", { name: "History", exact: true }).click();

// RSVP and messages
await page.getByRole("button", { name: "In", exact: true }).click();
await page.getByText("1 in").waitFor();
check(true, "RSVP In updates the count");
await page.getByRole("button", { name: "Who's in", exact: true }).click();
await page.getByPlaceholder(/Message the team/).fill("See you at 8:30! Parking: https://example.com/lot.");
await page.getByRole("button", { name: "Send" }).click();
await page.getByText("See you at 8:30!").waitFor();
check(
  (await page.getByRole("link", { name: "https://example.com/lot" }).getAttribute("href")) ===
    "https://example.com/lot",
  "a link in a message is tappable",
);
await page
  .getByPlaceholder("Message the team")
  .fill(`Sheet: https://docs.google.com/spreadsheets/d/${"x".repeat(160)}/edit?gid=1994446438#gid=1994446438`);
await page.getByRole("button", { name: "Send" }).click();
await page.getByRole("link", { name: /^https:\/\/docs\.google\.com/ }).waitFor();
// Nothing spills past its card (or its own box), except inside a strip meant to scroll sideways (filters, tables).
const fits = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".arow *, .panel *")].every((el) => {
      const card = el.closest(".arow, .panel") as Element;
      if (
        el.getBoundingClientRect().right <= card.getBoundingClientRect().right + 1 &&
        el.scrollWidth <= el.clientWidth + 1
      )
        return true;
      for (let a = el.parentElement; a && a !== card; a = a.parentElement)
        if (/auto|scroll/.test(getComputedStyle(a).overflowX)) return true;
      return false;
    }),
  );
check(await fits(), "a very long link doesn't widen the activity page");
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
await page.getByRole("button", { name: /^(Publish|Publish another pickleball)$/ }).click();
await page.waitForURL("**/a/*");
check(
  await page.getByRole("heading", { name: `Doubles ${stamp}` }).isVisible(),
  "pickleball page: title in the header",
);
check(
  !(await page.getByRole("button", { name: "Weather", exact: true }).count()),
  "indoor activity has no Weather panel",
);
const pkUrl = page.url();
// A teammate posts on the captain's ride: Home marks it, opening it shows where the new messages start, then it clears.
{
  const rideId = rideUrl.split("/a/")[1];
  const now = new Date().toISOString();
  sql(
    `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt, role, phone) values ('mate-${stamp}', 'Teammate ${stamp}', 'mate-${stamp}@example.test', 1, '${now}', '${now}', 'view', '+12035550119'); insert into messages (id, activity_id, kind, user_id, body, created_at) values ('msg-${stamp}', '${rideId}', 'user', 'mate-${stamp}', 'Count me in', '${new Date(Date.now() + 1000).toISOString()}')`,
  );
  await page.getByLabel("BBT home").click();
  const card = page.locator(`a.arow[href="/a/${rideId}"]`);
  await card.locator(".unseen").waitFor();
  check(
    (await card.locator(".badge.count").textContent()) === "1" &&
      (await card.locator(".unseen").textContent()) === "1 new message · Teammate",
    "Home marks a teammate's new message on the sport icon, with a reason line",
  );
  if (shots) await card.screenshot({ path: `${shots}/home-marked.png` });
  await card.click();
  await page.getByText("· 1 new").waitFor(); // in Who's in's summary line, even while it's closed
  if (!(await page.getByRole("separator").count()))
    await page.getByRole("button", { name: "Who's in", exact: true }).click();
  await page.getByRole("separator").waitFor();
  check((await page.getByRole("separator").textContent()) === "1 new", "the thread shows where new messages start");
  await page.getByRole("separator").scrollIntoViewIfNeeded();
  if (shots) await page.screenshot({ path: `${shots}/thread-new.png` });

  // @mentions: type @ and pick from the team; the message shows the name
  await page.reload(); // the team list is cached for a minute; the teammate was added behind the app's back
  await page.getByRole("button", { name: "Who's in", exact: true }).waitFor();
  await page.waitForTimeout(500);
  if (!(await page.getByPlaceholder(/Message the team/).count()))
    await page.getByRole("button", { name: "Who's in", exact: true }).click();
  const box = page.getByPlaceholder(/Message the team/);
  await box.fill(`Thanks @tea ${stamp.slice(0, 5)}`); // first letters of each name; local runs leave many teammates
  await page.getByRole("option", { name: `Teammate ${stamp}` }).waitFor();
  if (shots) await page.screenshot({ path: `${shots}/mention-pick.png` });
  await page.getByRole("option", { name: `Teammate ${stamp}` }).click();
  check((await box.inputValue()) === `Thanks @Teammate ${stamp} `, "picking a teammate puts their name in the message");
  await box.pressSequentially("bring the pump?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.locator(".mention", { hasText: `@Teammate ${stamp}` }).waitFor();
  check(true, "the sent message shows the mention");

  // Who's in: a name opens the contact card with Call, Text and the emergency contact
  await page.locator(".plist").getByRole("button", { name: "Captain Renamed" }).click();
  const cardDlg = page.getByRole("dialog", { name: "Contact Captain Renamed" });
  await cardDlg.waitFor();
  check(
    (await cardDlg.getByRole("link", { name: "Call", exact: true }).getAttribute("href")) === "tel:+19145550142" &&
      (await cardDlg.getByRole("link", { name: "Text" }).getAttribute("href")) === "sms:+19145550142" &&
      (await cardDlg.getByText("Chris Captain").isVisible()),
    "a name in Who's in opens Call, Text and the emergency contact",
  );
  if (shots) await page.screenshot({ path: `${shots}/contact-card.png` });
  await cardDlg.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("BBT home").click();
  await page.getByRole("link", { name: new RegExp(`Doubles ${stamp}`) }).waitFor();
  await page.waitForTimeout(500);
  check(!(await card.locator(".badge").count()), "opening it clears the marker");
}
await page.getByRole("link", { name: new RegExp(`Doubles ${stamp}`) }).waitFor();
check(await fits(), "home cards with warning chips fit the phone width");
{
  const ride = page.locator(".arow", { has: page.locator(".you-in") }).first();
  check((await ride.locator(".going").textContent())?.trim() === "1 going", "home card: 1 going and You're in");
}
check(await page.getByRole("button", { name: "Pickleball", exact: true }).isVisible(), "home shows sport filters");
await page.getByRole("button", { name: "Pickleball", exact: true }).click();
check(!(await page.getByRole("link", { name: /Katonah/ }).count()), "the filter hides other sports");
await shot(page, "home");

// Private: Plan's Visibility, then the lock on the icon and who hasn't answered (DESIGN.md → Private activities)
await page.getByTitle("Plan an activity").click();
await page.waitForURL("**/plan");
await page.getByRole("radio", { name: "Pickleball", exact: true }).click();
await page.getByRole("button", { name: "Indoor", exact: true }).click();
await page.getByLabel("Title (optional)").fill(`Private ${stamp}`);
await page.getByRole("button", { name: sundayLabel }).click();
await page.getByRole("radio", { name: /SUNY Purchase/ }).click();
await page.getByRole("radio", { name: /^Private/ }).click();
const privPublish = page.getByRole("button", { name: /^(Publish|Publish another pickleball)$/ });
check(await privPublish.isDisabled(), "private: Publish waits until someone is invited");
await page.getByLabel("Invite people").fill(`Teammate ${stamp}`);
await page.getByRole("checkbox", { name: `Teammate ${stamp}` }).check();
check(
  await page.locator(".vis").evaluate((el) => el.getBoundingClientRect().right <= document.documentElement.clientWidth),
  "the Visibility panel fits the phone width",
);
await page.getByRole("checkbox", { name: `Teammate ${stamp}` }).scrollIntoViewIfNeeded();
if (shots) await page.screenshot({ path: `${shots}/plan-private.png` });
await privPublish.click();
await page.waitForURL("**/a/*");
const privUrl = page.url();
check(await page.locator(".ahead-icon .lockbadge").isVisible(), "private: a lock on the activity's icon");
if (!(await page.getByText(/Not answered yet/).count()))
  await page.getByRole("button", { name: "Who's in", exact: true }).click();
check(
  (await page.getByText("Not answered yet (2)").isVisible()) &&
    (await page.getByText("Private: only the 2 people invited see this.").isVisible()),
  "private: Who's in lists who hasn't answered",
);
await shot(page, "private");
await page.getByLabel("Edit", { exact: true }).click();
await page.waitForURL("**/plan?edit=*");
await page.getByText("Private · 2 people").waitFor();
check(await page.getByRole("button", { name: "Make public" }).isVisible(), "private: editing offers Make public");
await page.getByLabel("BBT home").click();
await page.locator(`a.arow[href="${new URL(privUrl).pathname}"] .lockbadge`).waitFor();
check(true, "private: Home shows the lock on its icon");

// Team: everyone, with Call and Text
await page.getByTitle("Team").click();
await page.waitForURL("**/team");
await page.getByRole("link", { name: `Call Teammate ${stamp}` }).waitFor();
check(
  (await page.getByRole("link", { name: `Call Teammate ${stamp}` }).getAttribute("href")) === "tel:+12035550119" &&
    (await page.getByRole("link", { name: `Text Teammate ${stamp}` }).getAttribute("href")) === "sms:+12035550119",
  "Team lists teammates with Call and Text",
);
check(await fits(), "the Team page fits the phone width");
await shot(page, "team");

// Members from before contacts are asked for a phone once
sql(`update "user" set phone = null where email = 'captain-${stamp}@example.test'`);
await page.reload();
await page.getByRole("heading", { name: /One more thing/ }).waitFor();
check(
  !(await page.getByRole("link", { name: `Call Teammate ${stamp}` }).count()),
  "no phone → the app asks for one first",
);
await shot(page, "contact-first");
await page.getByLabel("Mobile phone").fill("12");
await page.getByRole("button", { name: "Save" }).click();
check(
  await page
    .getByRole("alert")
    .getByText(/phone number like/)
    .isVisible(),
  "a bad number is explained",
);
await page.getByLabel("Mobile phone").fill("914-555-0142");
await page.getByRole("button", { name: "Save" }).click();
await page.getByRole("link", { name: `Call Teammate ${stamp}` }).waitFor();
check(true, "saving the phone opens the app");

// Admins delete an activity for good
await page.goto(pkUrl);
await page.getByLabel("Edit", { exact: true }).click();
await page.waitForURL("**/plan?edit=*");
await page.getByRole("button", { name: "Delete pickleball" }).click();
const del = page.getByRole("dialog", { name: /^Delete / });
await del.waitFor();
await shot(page, "delete");
await del.getByRole("button", { name: "Delete for everyone" }).click();
await page.waitForURL(`${BASE}/`);
await page.getByLabel("BBT home").waitFor();
await page.waitForTimeout(800);
check(
  !(await page.getByRole("link", { name: new RegExp(`Doubles ${stamp}`) }).count()),
  "the deleted activity is gone",
);

// Help: Routes on your Garmin, from the account menu
await page.getByLabel("Account menu").click();
await page.getByRole("link", { name: /Routes on your Garmin/ }).click();
await page.waitForURL("**/help/garmin");
check(
  (await page.getByRole("heading", { name: "Routes on your Garmin" }).isVisible()) &&
    (await page.getByRole("heading", { name: "Route not on your Garmin?" }).isVisible()),
  "Help → Routes on your Garmin opens the guide",
);
check(await fits(), "the help page fits the phone width");
await shot(page, "help-garmin");

// Settings
await page.getByTitle("Settings").click();
await page.getByRole("button", { name: "Users", exact: true }).click();
await page.getByLabel("Invite (email address)").fill(`rider-${stamp}@example.test`);
await page.getByRole("button", { name: "Create invite link" }).click();
await page.locator(".notice input").waitFor();
check((await page.locator(".notice input").inputValue()).includes("/invite/"), "invite link shown to the Admin");
const mail = (await page.getByRole("link", { name: "Email it" }).getAttribute("href")) ?? "";
check(
  mail.startsWith(`mailto:rider-${stamp}%40example.test?`) && decodeURIComponent(mail).includes("/invite/"),
  "Email it opens a message to the invited address with the link",
);
await shot(page, "invite-link");

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
