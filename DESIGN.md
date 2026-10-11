# BBT Ride — Design

Status: **design complete** — clickable prototype at `prototype/index.html`; decisions in `DECISIONS.md`. Last updated 2026-10-11.
URL: **ride.bbt.team**

## Purpose
Help the BBT captain plan rides and the team show up prepared:
1. **Are the roads dry?** — look back at recent rain at each spot.
2. **What will the ride feel like?** — temp, real feel, bike feel, wind, rain across the ride window.
3. **What should we wear?**
4. **Where/when/which route?** — the published ride with RWGPS route details and parking pin.

## Users and roles
Sign-in is required. Two ways to sign in, both on the same account: **Continue with Google** (main) or **username/email + password**. Access is invite-only.

| Role | Can do |
|------|--------|
| **View** (default) | See upcoming and past rides with their weather; RSVP and post messages |
| **Edit** | View + plan, publish, edit and cancel rides; add start spots; delete any message |
| **Admin** | Edit + team settings (defaults, thresholds, kit chart), spots management, and users |

**How it's built:** [Better Auth](https://www.better-auth.com) (open source, free) runs inside the Worker and stores everything in D1. No outside identity service. Chosen 2026-10-11 over Cloudflare Access (no passwords) and hosted services (extra vendor, user data split from roles).
- **Invites:** an Admin enters an email and role in Settings → Users and copies the invite link to send (no email service). The link (7 days, one use) lets the person **continue with Google** (the verified Google email must match the invite) or **set a username and password**. Either way the account is created with the invited role. They can add the other method later.
- **Public sign-up is off.** A Google account or username that isn't invited gets "Not invited — ask a team admin"; nothing is created.
- **Passwords:** at least 10 characters; stored only as a salted PBKDF2-SHA256 hash via the Worker's built-in Web Crypto (Better Auth's default hashing can exceed the free Workers per-request CPU limit). Five failed attempts lock the account for 15 minutes.
- **Forgotten password:** an Admin creates a **reset link** (24 hours, one use) in Settings → Users and sends it. No self-service reset emails in v1.
- **Usernames:** each account has an email (needed for invites and notifications); a username is optional, and sign-in accepts either.
- **Sessions:** Better Auth's database sessions in an `HttpOnly; Secure; SameSite=Lax` cookie, 30-day sliding expiry. The role is read on each request, so a role change or disabling takes effect immediately.
- Every API route checks the role server-side; the UI only hides what the role can't do.
- **Bootstrap:** while no Admin exists, the Worker treats `BOOTSTRAP_ADMIN_EMAIL` (a Worker variable) as an Admin invite, so that person can sign in with Google or set a password.
- **No public pages:** every page, including a shared ride link, requires sign-in. The shared text carries the essentials (time, place, route links).
- **Audit:** `audit_log` records who changed rides, settings and users, and when.

### Data model (D1)
```
-- Better Auth core tables (user, session, account, verification), with our extra fields on user:
user(id, email UNIQUE, email_verified, name, username UNIQUE NULL, role CHECK(role IN ('view','edit','admin')) DEFAULT 'view',
     status CHECK(status IN ('active','disabled')), failed_logins DEFAULT 0, locked_until NULL, created_at, updated_at)
session(id, user_id, token, expires_at, ip_address, user_agent, created_at, updated_at)
account(id, user_id, provider_id ('google' | 'credential'), account_id, password NULL, created_at, updated_at)  -- one row per sign-in method
verification(id, identifier, value, expires_at)                                                              -- password reset links
invites(token PRIMARY KEY, email, role, invited_by, expires_at, used_at NULL)
settings(key PRIMARY KEY, value_json, updated_by, updated_at)        -- one row per setting
kit_bands(id, min_feel_f, name, items_json, sort)                    -- editable kit chart
spots(id, name, lat, lng, maps_url, note, archived)
rides(id, date, rollout, spot_id, pace_mph, notes, observed_json NULL, status CHECK(status IN ('published','cancelled')), created_by, updated_by, updated_at)
ride_updates(id, ride_id, user_id, summary, at)                       -- what changed, shown on the ride page
drafts(user_id PRIMARY KEY, ride_id NULL, form_json, updated_at)       -- editor autosave; ride_id set when editing
ride_routes(ride_id, sort, label, rwgps_route_id, stop_poi_json)
route_cache(rwgps_route_id PRIMARY KEY, json, fetched_at)
rsvps(ride_id, user_id, status CHECK(status IN ('in','out')), route_label NULL, updated_at, PRIMARY KEY(ride_id, user_id))
messages(id, ride_id, user_id, parent_id NULL, body, created_at, edited_at NULL, deleted_at NULL)  -- parent_id = reply to
push_subscriptions(endpoint PRIMARY KEY, user_id, keys_json, created_at)  -- one row per device that opted in
audit_log(id, user_id, action, entity, entity_id, diff_json, at)
```

## v1 scope

### Rides (home)
- Editor plans a ride on **any date** (weekend or weekday): date, roll-out time, start spot, avg pace, notes, and one or more routes. Publish (form autosaves; see Plan a ride).
  - Usually one route; occasionally a labeled alternate (e.g., "Full" / "Short") sharing the same spot and time.
- Home shows upcoming published rides as date tabs: this Saturday and Sunday always, plus any other upcoming day that has a published ride. The tab carries the date; the page doesn't repeat it.
- Ride page = warnings (only when something needs attention) + a stack of collapsible panels. Each collapsed header is the briefing; tapping it expands detail. Open/closed state is remembered per rider; panels start open on desktop.
  - **Meet** — collapsed: roll-out time · spot name (links to Google Maps). Expanded: estimated time back (moving + regroup buffer + coffee stop, and the time without the stop), parking notes, Open in Google Maps, and "+ Calendar", which opens a picker: Google Calendar, Apple Calendar (.ics), Outlook.com, Outlook (work or school), Other (.ics). The .ics is served by `/api/rides/:id.ics`; event = meet → back, location = parking pin, routes and notes in the description.
  - **Route** — collapsed: route name (opens RWGPS) · distance · climbing, plus the Full/Short switcher. Expanded: map, elevation profile, coffee stop (see below), "Open in RWGPS".
  - **Weather** — collapsed: temp range · real feel range · wind · rain chance, and a one-line kit hint. Expanded: ride-window summary (bike feel, gusts, rain total, roads), hourly table from the whole hour before roll-out to 3 h after the estimated return, rounded to whole hours (ride window shaded; Sky column uses icons for clear, partly cloudy, overcast, fog, drizzle, rain, showers, snow and thunder, with a moon for clear night hours and the label on hover and for screen readers), a "Full-day forecast" button that opens the rider's chosen weather source (NWS, Weather.com, Windy or Google; choice saved in their browser), then What to wear (Run cold / Avg / Run hot).
  - **Notes** — only if the ride has notes; collapsed shows the first line.
  - **Riders** — collapsed: "5 in · 1 out · 3 messages" plus **In / Out** buttons, so riders answer without opening the panel; tapping the selected answer again clears it. The Full / Short choice appears only when the ride has an alternate route and only after tapping In (main route preselected); Out never asks for a route. Expanded: who's in (with their route) and out, and a message thread for the ride: anyone can post, reply to a message (one level), and see everyone's messages. All signed-in roles can RSVP and post. Authors can edit or delete their own messages; Edit and Admin can delete any (moderation). The page refreshes RSVPs and messages every 30 s while open.
  - **Share** icon next to the day tabs: uses the phone's share sheet (Web Share API) with a text brief (date, meet time and Maps link, routes with RWGPS links, coffee stop, time back, weather, notes) plus the ride link; falls back to a copy-to-clipboard sheet. The ride link requires sign-in.
  - Warnings: wet/drying roads, cold, heat, wind, rain, thunder, low light (roll-out within 30 min of sunrise), and **active NWS alerts** for the spot's forecast zone (warnings red, advisories and watches amber; from api.weather.gov, cached by the Worker). No Go badge.
- "Open in RWGPS" works for riders only if the route is public or shared with them; the map and stats render regardless.
- **Coffee / muffin stop (optional)** — a ride can have an optional mid-ride stop.
  - Auto-suggested from the route's RWGPS POIs (`poi_type_name` = `coffee` or `food`, listed first); the editor confirms, picks another POI, or chooses no stop.
  - Route panel shows: name (links to Maps), mile marker, ETA (see ETA math), stop length (team setting, default 20 min; it extends the ride window) and an "optional" label. No separate stop forecast.
- **Past rides** — a **Past** tab after the date tabs on the Ride page (all roles). Newest first, grouped by month; each row shows date, start spot, route(s), how many rode, and the observed conditions at roll-out (temp, real feel, wind, roads), with a red "Cancelled" tag where it applies. A search box filters by route or spot.
  - Opening a past ride shows the same panels, read-only: Meet and Route as published, **Weather = observed** (saved from NWS station observations once the ride window has passed, not the old forecast), Notes, and Riders (who rode, who was out, and the full message thread; RSVP and posting are off).
  - Editors get **Reuse this plan**, which copies the ride into Plan on that same default day.
  - Data: no new tables. A ride is past once its date has passed; observed weather is stored with the ride (`rides.observed_json`). Nothing is deleted.

### Spots
- Fields: name, location (lat/lng), Google Maps link, parking notes (where to park, restrooms).
- **Add (Edit and Admin):** "Add a start spot" at the bottom of Plan's spot list. Enter a name, paste a Google Maps link (drop a pin on the parking spot → Share → Copy link) or plain coordinates, and parking notes; Save selects the new spot. Spot names must be unique.
  - Full Maps links are parsed in the browser (`@lat,lng` or `?q=lat,lng`). Short `maps.app.goo.gl` links are resolved by the Worker (follow the redirect, then parse), since browsers can't read cross-site redirects.
  - The Worker fetches the forecast for the new point on save.
- **Manage (Admin):** a Spots panel in Settings to rename, edit notes, move the pin, or archive. Archived spots drop out of the pick list but stay on past rides.

### What to wear
- Team kit chart keyed on **bike feel**, with add-ons for rain, wind, wet roads and thunder, and a shedding hint (see Kit chart); Admins edit it in Settings.
- Per-rider offset (runs cold / avg / hot, ±5°) stored in that rider's browser.

### Settings (Admin only, stored in D1)
Every setting lives in the `settings` table and is edited on the Settings page (gear icon); nothing is hard-coded except first-run defaults. Collapsible panels, each with a one-line summary of the current values:
- **Users:** invite by email with a role (copy invite link), change roles, disable, create a password reset link; shows each user's sign-in methods. A short line explains what each role can do.
- **Ride defaults:** roll-out **8:30**, weather window 3 h (used before a route is picked), pace 17 mph, coffee stop **20 min** (typical 15–20), regroup buffer **5 %** of moving time.
- **Road wetness:** look-back hours, Wet / Drying film thresholds.
- **Warnings:** amber and red thresholds for cold (bike feel), heat (real feel), wind, gusts, rain chance, rain amount.
- **Kit chart:** bands and items (`kit_bands`).
- **Spots:** rename, edit notes, move the pin, archive (see Spots).
- **Reset to defaults** restores the first-run values (not users or spots).

Team settings are stored in imperial units. Per-rider preferences stay in the rider's browser: theme, **units** (imperial by default; metric shows °C, km/h, km, m, mm) and ride notifications (all three in the account menu), Run cold / Avg / Run hot, weather source, and which panels are open.

### Plan a ride (Edit and Admin)
Planning is one top-to-bottom flow in the same panel style, mirroring the ride page. There is no separate Weekend page. Plan opens from the calendar-plus icon in the top bar, on the first weekend day the forecast covers that has no ride yet (otherwise this Saturday).
1. **Meet:** Sat / Sun buttons or any date from today on, roll-out time, then the **start spot**: a compact pick list, one row per spot: name, temp · real feel · wind · rain for the weather window, and warning chips only when something needs attention. Tap a row to select it. The selected spot gets a collapsed **Details** panel below: bike feel, gusts, rain and road state; rain bars −12 h → +8 h; hourly table (same range as the ride page); Full-day forecast and Radar; parking notes and Google Maps. The weather window is the default length (Settings) until a route is picked, then the route's actual ride time. The last row is **Add a start spot** (see Spots).
2. **Route:** routes that start at the chosen spot are listed first ("starts here"), then the captain's RWGPS library and the BBT club library via search, or a pasted RWGPS link; a note appears if the route starts away from the spot. Optional alternate route with labels, coffee stop from the route's POIs, pace (10–25 mph). Picking a route first (before a spot) selects its nearest spot.
3. **Notes.**
4. **Preview:** the actual ride-page warnings and panels for the draft, then **Publish**.

Drafts and changes:
- **No Save draft button.** The form autosaves per editor (`drafts` table), so a half-planned ride survives closing the page. "Start over" clears it.
- If a ride is already posted for the chosen date, the button reads **Replace ride** with a note; the replaced ride's RSVPs and messages go with it.
- **Editing a published ride:** editors get an Edit (pencil) icon on the ride page, next to Share. It opens Plan pre-filled with an "Editing the Sat, Oct 10 ride" bar, and the button reads **Update ride**. "Discard changes" leaves the published ride untouched.
  - RSVPs and messages are kept (moved along if the date changes).
  - If something riders care about changed (date, roll-out, start spot, route, coffee stop, notes), the ride page shows "Updated 9:12 PM · roll-out 8:30 → 9:00 AM" and the same text is posted to the Riders thread as a "Ride update" message.
  - **Cancel ride** marks it cancelled without deleting it: a red "Ride cancelled" banner on the ride page, a "Ride cancelled" message in the thread, and "CANCELLED:" at the start of the shared text. Editing a cancelled ride keeps it cancelled; only **Restore ride** undoes it.

### Notifications (v1)
- Only when a published ride is **updated** (any change that shows the "Updated" note) or **cancelled / restored**. No notifications for chat messages or replies; no RSVP reminders or deadlines.
- **Web Push only** (decided 2026-10-11; no email service). Riders opt in from the account menu on each device; on iPhone that requires adding the app to the Home Screen (iOS 16.4+). The Worker sends the push on Update ride / Cancel ride / Restore ride using VAPID keys. Riders without push see the "Updated" or "Cancelled" note and the thread message when they open the ride.

### Platform
- Mobile-first, installable PWA; desktop uses multi-column layout of the same views.
- **Real feel** is the standard apparent temperature; **bike feel** is defined under Algorithms.

## Brand
Source files in `brand/` (color sheet, logo .ai/.svg/.pdf, favicon). Web-ready versions in `brand/web/`:
- `bbt-logo.svg` — full bike logo, used in the top bar (5 KB; source SVG was 948 KB due to an embedded ICC profile).
- `bbt-wordmark.svg` — "bbt" wordmark for favicon/app icons (1 KB).
Both use `fill="currentColor"` so they can switch between navy, white, and orange.

| Name | sRGB | Use |
|------|------|-----|
| BBT Light Blue | `#0077D1` | Top bar; primary buttons (white text, 4.6:1 AA). Links on light use the darker `#0067B5`; links and outline buttons on dark use `#4DA3FF` |
| BBT Orange | `#FF3115` | Accent only: stripe under top bar, active tab underline. Not used for buttons |
| BBT Dark Blue | `#020C2B` | Dark-mode page background |
| Logo navy | `#03144D` | Primary text on light; dark-mode cards |
| BBT Transition Blue | `#041DB2` | Charts (rain bars, elevation profile) |

Navy roles confirmed 2026-10-09: `#020C2B` background, `#03144D` text and cards; `#1C367B` is not used.

- **Top bar** (the only navigation; there is no tab row): white bike logo on the left, which is the way home to Ride; on the right, **Plan** (calendar-plus icon) and **Settings** (gear) for roles that have them (icons only on phones, icon + label on wider screens), then an **account button** with the user's initial. View riders see just the logo and the account button. The account menu shows name, role and sign-in method; **Theme** (Auto / Light / Dark); **Units** (°F · mi / °C · km); **Ride notifications** (on/off for this device); and **Sign out**. Logo `bbt-logo.svg`, ~32px tall, on Light Blue, with a 4px orange stripe directly underneath (no separator). Same bar in light and dark mode; checked on a phone 2026-10-11, no hairline needed. No text next to the logo.

- Warnings use amber and red tinted pills and boxes (icon + label), never brand orange. There is no green "Go" state; a clean forecast shows nothing.
- Light and dark mode both supported; dark mode is navy-based, not gray.
- PWA icons (180/192/512) generated from the wordmark at build time.

## Algorithms
All inputs are Open-Meteo hourly values in °F, mph, inches, local time (America/New_York). `precipitation` at hour *h* is the total for the hour ending at *h*. Values between hours are linearly interpolated (wind direction, weather code and rain chance use the nearest hour). Reference implementation: `prototype/src/app.html` (`roadAt`, `bikeFeel`, `evaluate`, `kitAdvice`, `rideTimes`).

### Road wetness (Dry / Drying / Wet)
A water-film bucket run over the look-back window (default **12 h**) ending at the time being judged. Film `W` is in mm and starts at 0.

For each hour *i* in the window, oldest first:
1. `W = min(2.0, W + rain_i × 25.4)` — rain adds film; anything above 2 mm runs off.
2. `W = max(0, W − D_i)` — drying, where
   ```
   Tc     = temperature in °C
   spread = max(0, temperature − dew point) in °C
   SW     = shortwave radiation, W/m²  (if missing: is_day × (1 − cloud%/100) × 600)
   D      = (0.02 + 0.004·max(0,Tc) + 0.015·min(spread,15) + 0.0006·SW) × (1 + 0.03·min(wind_mph,20))
   if spread < 1 °C:          D ×= 0.25   (near-saturated air / dew)
   if rain_i > 0.1 mm:        D ×= 0.2    (still raining)
   ```
   Sanity anchors: sunny 68 °F, 14 °F spread, 8 mph, 600 W/m² → ~0.7 mm/h (1 mm gone in ~1.5 h). Calm overcast night 46 °F, 3 °F spread → ~0.08 mm/h (wet roads stay wet till morning).

Output:
| State | Rule | Warning |
|---|---|---|
| **Wet** | rain ≥ 0.01" in the current hour, or `W ≥ 0.5 mm` | Red |
| **Drying** | `0.1 ≤ W < 0.5 mm` | Amber |
| **Dry** | `W < 0.1 mm` | none |

Also shown: rain total in the look-back window. The warning uses the state at roll-out and notes if it changes by the finish. Coefficients are a first guess, to be tuned against real rides (compare the warning with what the team found).

### Bike feel
Wind chill using the relative airflow a rider feels. Over a loop the rider meets the wind from every angle, so the average airflow is approximated as `V = √(pace² + wind²)` (17 mph pace + 10 mph wind → 19.7 mph).

```
WC(T, V) = 35.74 + 0.6215·T − 35.75·V^0.16 + 0.4275·T·V^0.16      (NWS wind chill)

T ≤ 50 °F         bike feel = min(T, WC(T, V))
50 < T < 70 °F    bike feel = T + (WC(50, V) − 50) × (70 − T) / 20     ← taper
T ≥ 70 °F         bike feel = real feel (apparent temperature)
```
The NWS formula is only defined for T ≤ 50 °F. Above that we take the chill delta at 50 °F (≈ −6 °F at 20 mph airflow) and fade it linearly to zero at 70 °F, where heat and humidity matter more than airflow. Example at 17 mph, 5 mph wind: 40 °F → 31°, 50 °F → 44°, 60 °F → 57°, 75 °F → real feel.

Display: range over the ride window (min–max), next to temp and real feel.

### Warnings (amber / red)
Evaluated on 15-minute samples across the ride window. Each factor gets a level: none, amber (caution) or red (no-go). Only factors with a level are shown, as warnings on the ride page and chips in Plan's start-spot list; there is no overall Go badge. Defaults (thresholds editable in Settings):

| Factor | Measure | Amber | Red |
|---|---|---|---|
| Road | state at roll-out | Drying | Wet |
| Cold | min bike feel | < 40 °F | < 32 °F |
| Heat | max real feel | ≥ 92 °F | ≥ 100 °F |
| Wind | max sustained / max gust | ≥ 15 / ≥ 25 mph | ≥ 22 / ≥ 35 mph |
| Rain | max chance / total in window | ≥ 30 % / ≥ 0.01" | ≥ 60 % / ≥ 0.05" |
| Thunder | weather code 95–99 in window (replaces the rain warning) | — | any |
| Low light | roll-out within 30 min of sunrise | yes | — |
| NWS alert | active alert for the spot's forecast zone | advisory, watch | warning |

### Kit chart
Bands on minimum bike feel over the ride, after the rider's offset (runs cold −5°, avg 0, runs hot +5°; stored in the rider's browser).

| Bike feel | Band | Kit |
|---|---|---|
| ≥ 70° | Summer | SS jersey, bib shorts, light socks, sunglasses + sunscreen |
| 60–69° | Mild | SS jersey, bib shorts, arm warmers for the start (optional) |
| 52–59° | Cool | SS jersey + arm warmers, bibs + knee warmers, wind vest, light gloves |
| 45–51° | Chilly | Base layer, LS jersey, knee warmers or 3/4 bibs, wind vest, full-finger gloves |
| 38–44° | Cold | LS base, thermal jersey, bib tights, wind vest, full-finger gloves, headband/cap, toe covers |
| 30–37° | Very cold | Thermal base, thermal jacket, thermal tights, winter gloves, skull cap, shoe covers |
| < 30° | Deep winter | Thermal base, winter jacket, thermal tights, lobster gloves, balaclava, winter shoe covers |

Add-ons:
- **Packable rain jacket** — the rain warning's amber thresholds (default: chance ≥ 30 % or ≥ 0.01" expected in the window).
- **Clip-on fenders + shoe covers** — road Drying or Wet at roll-out.
- **Wind vest** — sustained wind ≥ 12 mph and the band doesn't already include one.
- **Rethink the ride** — thunder in the window.
- **Shedding hint** — bike feel is warmer at the finish than the start, spans ≥ 8° and crosses a band: dress for the coldest band, pack layers to shed down to the warmest.

### ETA math
```
moving time      = distance ÷ pace                         (46.2 mi ÷ 17 mph = 2 h 43 m)
k                = 1 + regroup buffer (default 5 % → 1.05)
ETA at mile m    = roll-out + (m ÷ pace) × k               (Tazza, mile 24.4 → 8:30 + 1 h 30 m = 10:00)
after the stop   = + stop length (default 20 min)
ride window      = roll-out → roll-out + moving time × k + stop (8:30 → 11:41)
```
Mile markers come from the POI's distance along the RWGPS track (nearest track point). The regroup buffer is an Admin setting; 0 % gives pure moving time. There is no separate coffee-stop forecast; per-point route weather is Phase 2.

## Prototype
`prototype/index.html` — one self-contained file (inline CSS/JS, Leaflet 1.9.4 from cdnjs). Built from `prototype/src/app.html` by `python3 prototype/build.py`, which inlines `data/seed.json`, the fallback forecast `data/raw/om_purchase.json`, and the logo.
- Fetches Open-Meteo live in the browser for the start spots (one multi-location request, `past_days=2`). On failure it uses the embedded sample (SUNY Purchase, Oct 7–11) for every spot and shows a banner.
- Screens: Sign-in (Google + password), Ride (date tabs + Past; Meet / Route / Weather / Notes / Riders panels; share, calendar, edit), Plan (spot comparison → route → preview that reuses the ride panels; autosaved draft), Settings (panels, incl. Users with invite and reset links). A View / Edit / Admin switcher and a "Sign-in screen" link sit below the top bar.
- Prototype-only: everything you change lives in this browser or this session; sample rides, riders, messages and past rides are examples. Not in the prototype: NWS alerts, metric display (the Units choice is saved, values stay imperial), Spots management, kit chart editing, disabling users, message edit/delete, notifications, the 30 s refresh, observed weather from NWS (past rides use sample values).
- Without Leaflet (offline/CDN blocked) maps fall back to an SVG route outline.

## Data sources
- **Forecast:** Open-Meteo (free, no key), hourly, `best_match` (HRRR and NBM for the US); `past_days=2` supplies the recent rain for road wetness. The Worker fetches all spots in one request and caches it in KV.
- **Observed and alerts:** nearest NWS station observations (saved on past rides) and NWS active alerts (api.weather.gov, no key). Radar: link to RainViewer.
- **Routes:** RideWithGPS API v1 (API key + secret + auth token, stored as Worker secrets; see Secrets). To verify at build time: listing club/organization routes via the API; paste-link fallback always works.

## Secrets
Never in the repo, the built assets, or any response to the browser. All third-party calls that need a credential go through the Worker.

| Secret | Where it lives | Used by |
|---|---|---|
| `RWGPS_API_KEY`, `RWGPS_API_SECRET`, `RWGPS_AUTH_TOKEN` | Cloudflare Worker secrets (`wrangler secret put …`) | Worker → RideWithGPS |
| `GOOGLE_CLIENT_ID` (not secret), `GOOGLE_CLIENT_SECRET` | Worker variable / Worker secret | Google sign-in |
| `SESSION_SECRET` (random 32 bytes) | Worker secret | Better Auth's signing secret (cookies, OAuth state, invite and reset tokens) |
| `VAPID_PUBLIC_KEY` (not secret), `VAPID_PRIVATE_KEY` | Worker variable / Worker secret | Web Push notifications |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub repository secrets (Actions deploy) and your local `.env` (manual deploys) | `wrangler deploy`, D1 migrations |

- Local development: Worker secrets in `.dev.vars`, Cloudflare credentials in `.env` (both git-ignored); `.dev.vars.example` lists the names with empty values.
- Verified 2026-10-11: `RWGPS_API_KEY`, `RWGPS_API_SECRET`, `RWGPS_AUTH_TOKEN`, `SESSION_SECRET` are set on the `bbt-ride` Worker. `GOOGLE_CLIENT_SECRET` (pending the Google OAuth client) and `VAPID_PRIVATE_KEY` (generated when the app is built) are still to set.
- Worker secrets are write-only: once set, Cloudflare never shows them again; rotate by running `wrangler secret put` with the new value.
- The browser calls `/api/routes/:id` and `/api/routes/search`; the Worker adds the RWGPS credentials and caches results in D1 `route_cache`.

## Architecture
- Cloudflare Worker + static assets (React + TypeScript + Vite) on ride.bbt.team.
- D1: the tables in Data model. KV: forecast and NWS alert cache.
- Every route requires a session (Google or password sign-in via Better Auth); API routes enforce View / Edit / Admin server-side.
- Deploys: GitHub Actions on merge to `main` (runs D1 migrations, then `wrangler deploy`), using the repository's Cloudflare secrets. `ride.bbt.team` is attached once by hand in the Cloudflare dashboard.

## Backlog (post-v1)
1. **Route weather** — forecast at points along the route by ETA; head/tail/crosswind per segment.
2. **WhatsApp integration** (or another messenger) — post the ride brief to the group chat.
3. **Model comparison** — HRRR vs NBM vs ECMWF agreement as a confidence hint.

## Seed data
`data/seed.json` (built 2026-10-08 from public sources; raw responses in `data/raw/`):
- Spots: SUNY Purchase, Armonk, Reeves (coordinates resolved from the Google Maps links).
- Routes: 57426135, 57406828, 57215407, 37475253 with stats, simplified track (lat, lng, elev m, dist m), POIs with distance along route, and nearest spot (all start within 160 m of a spot).
- 36 route IDs linked from the public RWGPS group page `groups/BBT`.
- Default pace 17 mph.

Verified 2026-10-08: public route JSON (`/routes/{id}.json`) needs no key; listing a user's routes (`/users/{id}/routes.json`) returns 403 without auth; Open-Meteo `best_match`, `gfs_hrrr`, `ncep_nbm_conus`, `minutely_15`, `past_days` all work for these spots; NWS points API works (grid OKX).

## Decisions
See `DECISIONS.md`.
