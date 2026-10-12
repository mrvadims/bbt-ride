# BBT Ride — Design

Status: **v1 built** (branch `app-v1`; see README for running it) — design prototype at `prototype/index.html`; decisions in `DECISIONS.md`. Last updated 2026-10-12.
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

**How it's built:** [Better Auth](https://www.better-auth.com) (open source, free) runs inside the Worker and stores everything in D1. No outside identity service. Chosen 2026-10-11 over Cloudflare Access (no passwords) and hosted services (extra vendor, user data split from roles). Plugins: **username** (sign in with a username) and **admin** (roles `view` / `edit` / `admin`, default `view`; disable = ban; delete; revoke sessions).
- **Invites:** an Admin enters an email and role in Settings → Users and copies the invite link to send (no email service). The link (7 days, one use) opens a page offering **Continue with Google** or **set a name, username and password**. Either way the account gets the invited role. A Google account can add a password later through an Admin reset link.
- **Who may create an account:** a Better Auth hook allows a new account only when an unexpired, unused invite exists for that email (for Google, the Google account's email). Anyone else gets "Not invited — ask a team admin" and nothing is created. Password accounts are created only through the invite link, never by open sign-up.
- **Passwords:** at least 10 characters; stored as a salted PBKDF2-SHA256 hash (100,000 iterations, the Workers maximum) via Web Crypto, plugged into Better Auth's password `hash` / `verify`. Better Auth's default scrypt can exceed the free plan's 10 ms CPU limit; if PBKDF2 does too, the fallback is Workers Paid ($5/month).
- **Sign-in attempts** are rate-limited by Better Auth (5 per 15 minutes per IP on the sign-in endpoints, counters in D1). No account lockout, so nobody can lock a rider out by guessing.
- **Forgotten password:** an Admin creates a **reset link** (24 hours, one use) in Settings → Users and sends it. No self-service reset emails in v1.
- **Usernames:** each account has an email (needed for invites and Google matching); a username is optional, and sign-in accepts either.
- **Sessions:** Better Auth database sessions in an `HttpOnly; Secure; SameSite=Lax` cookie, 30-day expiry renewed daily while in use; no cookie cache, so a role change or disabling takes effect on the next request.
- **Server-side checks:** every `/api/*` route except `/api/health` and the invite/reset link endpoints checks the session and role; the UI only hides what the role can't do. Requests that change data must come from the app's own origin (Origin header check), and every input is validated against a schema; messages are capped at 2,000 characters; display names are 1–80 characters and can't be a system label ("Ride update", "Former member"); push subscriptions must point at a browser push service (Google, Mozilla, Apple or Microsoft push domains). Validation errors come back as a readable message. Static pages carry a Content-Security-Policy, `frame-ancestors 'none'` and `Referrer-Policy: no-referrer` (`public/_headers`); API responses get Hono's secure headers.
- **Bootstrap:** while no Admin exists, the hook treats `BOOTSTRAP_ADMIN_EMAIL` (a Worker variable) as an Admin invite.
- **Public pages: sign-in, the invite and reset link pages, and `/privacy`.** The link pages work only with a valid token (the invite page shows the invited email). The app's code and styles are public static files (they contain no team data); everything the app shows comes from `/api/*`, which requires a session, so a shared ride link opens the sign-in page first. `/privacy` (`public/privacy.html`, linked from the sign-in page) is required by Google to publish the sign-in app. The `workers.dev` address and preview URLs are turned off.
- **Google data kept:** name, email and the Google account ID only. The profile photo and Google's access and refresh tokens are discarded (sign-in needs nothing after the first exchange).
- **Audit:** `audit_log` records who changed rides, settings and users, and when. No screen in v1; read it with `wrangler d1 execute`.

### Data model (D1)
Better Auth's tables are generated from its configuration (`scripts/auth-schema.ts` → `0001_auth.sql`); ours are plain SQL migrations. Every reference to a user is `ON DELETE CASCADE` (sessions, accounts, RSVPs, drafts, push subscriptions, a user's reset links) or `ON DELETE SET NULL` (authorship of rides, messages, settings, invites, audit entries).
```
-- Better Auth (generated): user (+ username, displayUsername, role, banned, banReason, banExpires), session, account, verification, rateLimit
links(token_hash PRIMARY KEY, kind CHECK(kind IN ('invite','reset')), email, role NULL, user_id NULL, created_by NULL,
      created_at, expires_at, used_at NULL)                     -- invite (7 days) and reset (24 h) links; only a SHA-256 of the token is stored
settings(key PRIMARY KEY, value_json, updated_by NULL, updated_at)   -- one row per setting
kit_bands(id, min_feel_f, name, items_json)                          -- editable kit chart, ordered by min_feel_f
spots(id, name UNIQUE, lat, lng, maps_url, note, archived DEFAULT 0, created_at)
rides(id, date, meet_time, spot_id, pace_mph, notes, observed_json NULL, status CHECK(status IN ('published','cancelled')),
      created_by NULL, updated_by NULL, created_at, updated_at)   -- UNIQUE(date) WHERE status = 'published'
ride_routes(ride_id, sort, label, rwgps_route_id, stop_poi NULL, PRIMARY KEY(ride_id, sort))  -- stop_poi = name of the route's POI
route_cache(rwgps_route_id PRIMARY KEY, name NULL, json NULL, in_library DEFAULT 0, fetched_at NULL)  -- in_library = listed in route search
drafts(user_id PRIMARY KEY, ride_id NULL, form_json, updated_at)  -- editor autosave; ride_id set when editing
rsvps(ride_id, user_id, status CHECK(status IN ('in','out')), route_label NULL, updated_at, PRIMARY KEY(ride_id, user_id))
messages(id, ride_id, user_id NULL, parent_id NULL, kind CHECK(kind IN ('user','update','cancel','restore')) DEFAULT 'user',
         body, created_at, edited_at NULL, deleted_at NULL)       -- parent_id = reply to; kind 'update' etc. = "Ride update" posts;
                                                                  -- user_id NULL on a 'user' message = former member
push_subscriptions(endpoint PRIMARY KEY, user_id, keys_json, created_at)  -- one row per device that opted in
audit_log(id, user_id NULL, action, entity, entity_id, diff_json, at)
```
The ride page's "Updated Sat 9:12 PM · …" note is the latest `kind = 'update'` message, so there is no separate updates table.

## v1 scope

### Rides (home)
- Editor plans a ride on **any date** (weekend or weekday): date, meet time, start spot, avg pace, notes, and one route or two (main and alternate). Publish (form autosaves; see Plan a ride).
  - Usually one route; occasionally a labeled alternate (e.g., "Full" / "Short") sharing the same spot and time.
- Home shows upcoming rides as date tabs: this Saturday and Sunday always, plus any other upcoming day that has a ride (published or cancelled). The tab carries the date; the page doesn't repeat it.
- Ride page = warnings (only when something needs attention) + a stack of collapsible panels. Each collapsed header is the briefing; tapping it expands detail. Open/closed state is remembered per rider; panels start open on desktop.
  - **Meet** — collapsed: meet time · spot name (links to Google Maps). Expanded: estimated time back (moving + regroup buffer + coffee stop, and the time without the stop), parking notes, Open in Google Maps, and "+ Calendar", which opens a picker: Google Calendar, Apple Calendar (.ics), Outlook.com, Outlook (work or school), Other (.ics). The .ics file is generated in the browser (an iPhone Home Screen app doesn't share its sign-in with Safari, so a server link wouldn't work there); event = meet → back, location = the parking pin's coordinates (so calendar apps open the pin in Maps and car navigation can route to it; .ics also carries GEO), and the spot's name and Maps link, parking notes, routes and notes in the description.
  - **Route** — collapsed: route name (opens RWGPS) · distance · climbing, plus the Full/Short switcher. Expanded: map, elevation profile, coffee stop (see below), "Open in RWGPS".
  - **Weather** — collapsed: temp range · real feel range · wind · rain chance, and a one-line kit hint. Expanded: ride-window summary (bike feel, gusts, rain total, roads), hourly table from the whole hour before meet time to 3 h after the estimated return, rounded to whole hours (ride window shaded; Sky column uses icons for clear, partly cloudy, overcast, fog, drizzle, rain, showers, snow and thunder, with a moon for clear night hours and the label on hover and for screen readers), a "Full-day forecast" button that opens the rider's chosen weather source (NWS, Weather.com, Windy or Google; choice saved in their browser), then What to wear (Run cold / Avg / Run hot).
  - **Notes** — only if the ride has notes; collapsed shows the first line.
  - **Riders** — collapsed: "5 in · 1 out · 3 messages" plus **In / Out** buttons, so riders answer without opening the panel; tapping the selected answer again clears it. The Full / Short choice appears only when the ride has an alternate route and only after tapping In (main route preselected); Out never asks for a route. Expanded: who's in (with their route) and out, and a message thread for the ride: anyone can post, reply to a message (one level), and see everyone's messages. All signed-in roles can RSVP and post while the ride is upcoming and not cancelled (a cancelled ride's thread stays readable). Authors can edit or delete their own messages while the ride is upcoming; Edit and Admin can delete any message, also on past rides (moderation). The page refreshes RSVPs and messages every 30 s while open.
  - **Share** icon next to the day tabs: uses the phone's share sheet (Web Share API) with a text brief (date, meet time and Maps link, routes with RWGPS links, coffee stop, time back, weather, notes) plus the ride link; falls back to a copy-to-clipboard sheet. The ride link requires sign-in.
  - Warnings: wet/drying roads, cold, heat, wind, rain, thunder, low light (meet time within 30 min of sunrise), and **active NWS alerts** at the spot's location (warnings red, advisories and watches amber; see Warnings).
- "Open in RWGPS" works for riders only if the route is public or shared with them; the map and stats render regardless.
- **Coffee / muffin stop (optional)** — a ride can have an optional mid-ride stop.
  - Auto-suggested from the route's RWGPS POIs (`poi_type_name` = `coffee` or `food`, listed first); the editor confirms, picks another POI, or chooses no stop.
  - Route panel shows: name (links to Maps), mile marker, ETA (see ETA math), stop length (team setting, default 20 min; it extends the ride window) and an "optional" label. No separate stop forecast.
- **Past rides** — a **Past** tab after the date tabs on the Ride page (all roles). Newest first, grouped by month; each row shows date, start spot, route(s), how many rode, and the recorded conditions at meet time (temp, real feel, wind, roads), with a red "Cancelled" tag where it applies. A search box filters by route or spot.
  - Opening a past ride shows the same panels, read-only: Meet and Route as published, **Weather = recorded at meet time** (temp, real feel, wind and gusts, rain, roads and sky from Open-Meteo's past hours for the spot, saved after the ride window has passed, not the old forecast; same algorithms, so roads come out the same way; no hourly table or kit), Notes, and Riders (who rode, who was out, and the full message thread; RSVP and posting are off).
  - Editors get **Reuse this plan**, which copies the ride into Plan on that same default day.
  - Data: no new tables. A ride is past once its date has passed; recorded weather is stored with the ride (`rides.observed_json`), written by a scheduled Worker job every 3 hours for published rides up to two days old (Open-Meteo's past hours reach back two days; a ride the job misses, or a cancelled one, shows no conditions). Rides are never deleted.

### Spots
- Fields: name, location (lat/lng), Google Maps link, parking notes (where to park, restrooms). Name, link and notes are all required.
- **Add (Edit and Admin):** "Add a start spot" at the bottom of Plan's spot list. Enter a name, paste a Google Maps link (drop a pin on the parking spot → Share → Copy link) or plain coordinates, and parking notes; Save selects the new spot. Spot names must be unique.
  - The Worker reads the pin from the link on save, pin first: `!3d<lat>!4d<lng>`, then `q=` / `query=` / `/search/<lat>,<lng>`, then `@lat,lng` (that one is the map's centre, so it's the last resort). Short `maps.app.goo.gl` links are followed one redirect (only from that host). The pasted Google Maps link is kept as the spot's link; anything else gets a coordinates link.
  - The app reloads the forecast after saving, which fetches it for the new point.
- **Manage (Admin):** the Spots panel in Settings lists each spot (name and parking notes) with **Open in Maps** (to check the pin), **Edit** (the same three fields in place; paste a new link to move the pin) and **Archive**, plus **Add a spot**. Archived spots drop out of the pick list but stay on past rides and on upcoming rides that already use them (which keep their forecast and recorded weather); they sit in a collapsed Archived list with Restore.

### What to wear
- Team kit chart keyed on **bike feel**, with add-ons for rain, wind, wet roads and thunder, and a shedding hint (see Kit chart); Admins edit it in Settings.
- Per-rider offset (runs cold / avg / hot, ±5°) stored in that rider's browser.

### Settings (Admin only, stored in D1)
Team settings live in D1 (`settings`, `kit_bands`, `spots`) and are edited on the Settings page (gear icon). Fixed by design, not settings: low light = meet time within 30 min of sunrise, wind-vest add-on at 12 mph, shedding hint at 8°, pace 10–25 mph. Collapsible panels in a single column (so opening one never leaves a gap beside it), each with a one-line summary of the current values:
- **Users:** invite by email with a role (copy invite link), change roles, disable, create a password reset link, delete on request; shows each user's sign-in methods. Disabled members get no ride notifications. A short line explains what each role can do. Deleting removes the account, sign-in methods, sessions, push subscriptions, drafts and RSVPs; the person's messages stay on past rides as "Former member".
- **Ride defaults:** meet time **8:30**, weather window 3 h (used before a route is picked), pace 17 mph, coffee stop **20 min** (typical 15–20), regroup buffer **5 %** of moving time.
- **Road wetness:** look-back hours, Wet / Drying film thresholds.
- **Warnings:** amber and red thresholds for cold (bike feel), heat (real feel), wind, gusts, rain chance, rain amount.
- **Kit chart:** each band's lower bound, name and items (`kit_bands`); the seven bands are fixed in number.
- **Spots:** list with Open in Maps, Edit and Archive; Add a spot (see Spots).
- **Reset to defaults** restores the first-run values (not users or spots).

Team settings are stored in imperial units. Per-rider preferences stay in the rider's browser: theme, **units** (imperial by default; metric shows °C, km/h, km, m, mm) and ride notifications (all three in the account menu), Run cold / Avg / Run hot, weather source, and which panels are open.

### Plan a ride (Edit and Admin)
Planning is one top-to-bottom flow in the same panel style, mirroring the ride page. There is no separate Weekend page. Plan opens from the calendar-plus icon in the top bar, on the first weekend day in the coming week that has no ride yet (otherwise this Saturday). The form opens straight away; the forecast fills in when it arrives.
1. **Meet:** Sat / Sun buttons or any date from today on (the app's own date picker: weeks start on Monday, weekends shaded), meet time, then the **start spot**: a compact pick list, one row per spot: name, temp · real feel · wind · rain for the weather window, and warning chips only when something needs attention. Tap a row to select it. The selected spot gets a collapsed **Details** panel below: bike feel, gusts, rain and road state; rain bars −12 h → +8 h; hourly table (same range as the ride page); Full-day forecast and Radar; parking notes and Google Maps. The weather window is the default length (Settings) until a route is picked, then the route's actual ride time. Below the list is **Add a start spot** (see Spots).
2. **Route:** routes that start at the chosen spot are listed first ("starts here"), then the captain's RWGPS library and the BBT club library via search, or a pasted RWGPS link (a link that can't be loaded, e.g. a private route, says so); a picked route shows an Open in RWGPS link; a note appears if the route starts away from the spot. Optional alternate route with labels, coffee stop from the route's POIs, pace (10–25 mph). Picking a route first (before a spot) selects its nearest spot.
3. **Notes.**
4. **Preview:** the actual ride-page warnings and panels for the draft, then **Publish**.

Drafts and changes:
- **No Save draft button.** The form autosaves per editor (`drafts` table) once something is changed, so a half-planned ride survives closing the page; just opening a ride to edit or reuse leaves the saved draft alone. "Start over" clears it.
- If a ride is already posted for the chosen date, the button reads **Replace ride** with a note. Replacing cancels the old ride (it keeps its RSVPs and messages in history, and its riders get a "Ride cancelled" notification) and publishes the new one.
- **Editing a published ride:** editors get an Edit (pencil) icon on the ride page, next to Share. It opens Plan pre-filled with an "Editing the Sat, Oct 10 ride" bar, and the button reads **Update ride**. "Discard changes" leaves the published ride untouched.
  - RSVPs and messages are kept (moved along if the date changes). A route choice on an RSVP is cleared if that alternate is removed or relabelled. Past rides can't be edited.
  - If something riders care about changed (date, meet time, start spot, route, coffee stop, notes), the ride page shows "Updated Sat 9:12 PM · meet 8:30 → 9:00 AM" and the same text is posted to the Riders thread as a "Ride update" message.
  - **Cancel ride** marks it cancelled without deleting it: a red "Ride cancelled" banner on the ride page, a "Ride cancelled" message in the thread, and "CANCELLED:" at the start of the shared text. Editing a cancelled ride keeps it cancelled; only **Restore ride** undoes it.

### Notifications (v1)
- Only when a published ride is **updated** (any change that shows the "Updated" note) or **cancelled / restored**. No notifications for chat messages or replies; no RSVP reminders or deadlines.
- **Web Push only** (decided 2026-10-11; no email service). Riders opt in from the account menu on each device; on iPhone that requires adding the app to the Home Screen (iOS 16.4+). The Worker sends the push on Update ride / Cancel ride / Restore ride (and to the replaced ride's riders on Replace) using VAPID keys; disabled members get none. Tapping a notification opens the ride. Riders without push see the "Updated" or "Cancelled" note and the thread message when they open the ride.

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
| BBT Transition Blue | `#041DB2` | Charts (rain bars, elevation profile) in light mode; dark mode uses `#7FB2FF` |

Navy roles confirmed 2026-10-09: `#020C2B` background, `#03144D` text and cards; `#1C367B` is not used.

- **Top bar** (the only navigation; there is no tab row): white bike logo on the left, which is the way home to Ride; on the right, **Plan** (calendar-plus icon) and **Settings** (gear) for roles that have them (icons only on phones, icon + label on wider screens), then an **account button** with the user's initial. View riders see just the logo and the account button. The account menu shows name, role and sign-in method; **Theme** (Auto / Light / Dark); **Units** (°F · mi / °C · km); **Ride notifications** (on/off for this device); and **Sign out**. Logo `bbt-logo.svg`, ~32px tall, on Light Blue, with a 4px orange stripe directly underneath (no separator). Same bar in light and dark mode; checked on a phone 2026-10-11, no hairline needed. No text next to the logo.

- Warnings use amber and red tinted pills and boxes (icon + label), never brand orange. There is no green "Go" state; a clean forecast shows nothing.
- Light and dark mode both supported; dark mode is navy-based, not gray.
- PWA icons (180/192/512) are rendered from the wordmark by `npm run icons` (scripts/icons.ts) into `public/icons/`.

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
   if rain_i > 0.004" (0.1 mm): D ×= 0.2  (still raining)
   ```
   Sanity anchors: sunny 68 °F, 14 °F spread, 8 mph, 600 W/m² → ~0.7 mm/h (1 mm gone in ~1.5 h). Calm overcast night 46 °F, 3 °F spread → ~0.08 mm/h (wet roads stay wet till morning).

Output:
| State | Rule | Warning |
|---|---|---|
| **Wet** | rain ≥ 0.01" in the current hour, or `W ≥ 0.5 mm` | Red |
| **Drying** | `0.1 ≤ W < 0.5 mm` | Amber |
| **Dry** | `W < 0.1 mm` | none |

Also shown: rain total in the look-back window. The warning uses the state at meet time and notes if it changes by the finish. Coefficients are a first guess, to be tuned against real rides (compare the warning with what the team found).

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
| Road | state at meet time | Drying | Wet |
| Cold | min bike feel | < 40 °F | < 32 °F |
| Heat | max real feel | ≥ 92 °F | ≥ 100 °F |
| Wind | max sustained / max gust | ≥ 15 / ≥ 25 mph | ≥ 22 / ≥ 35 mph |
| Rain | max chance / total in window | ≥ 30 % / ≥ 0.01" | ≥ 60 % / ≥ 0.05" |
| Thunder | weather code 95–99 in window (replaces the rain warning) | — | any |
| Low light | meet time within 30 min of sunrise | yes | — |
| NWS alert | active alert at the spot | advisory, watch | warning |

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
- **Clip-on fenders + shoe covers** — road Drying or Wet at meet time.
- **Wind vest** — sustained wind ≥ 12 mph and the band doesn't already include one.
- **Rethink the ride** — thunder in the window.
- **Shedding hint** — bike feel is warmer at the finish than the start, spans ≥ 8° and crosses a band: dress for the coldest band, pack layers to shed down to the warmest.

### ETA math
```
moving time      = distance ÷ pace                         (46.2 mi ÷ 17 mph = 2 h 43 m)
k                = 1 + regroup buffer (default 5 % → 1.05)
ETA at mile m    = meet time + (m ÷ pace) × k               (Tazza, mile 24.4 → 8:30 + 1 h 30 m = 10:00)
after the stop   = + stop length (default 20 min)
ride window      = meet time → meet time + moving time × k + stop (8:30 → 11:41)
```
Mile markers come from the POI's distance along the RWGPS track (nearest track point). The regroup buffer is an Admin setting; 0 % gives pure moving time. Weather along the route is in the backlog.

## Prototype
`prototype/index.html` — one self-contained file (inline CSS/JS, Leaflet 1.9.4 from cdnjs). Built from `prototype/src/app.html` by `python3 prototype/build.py`, which inlines `data/seed.json`, the fallback forecast `data/raw/om_purchase.json`, and the logo.
- Fetches Open-Meteo live in the browser for the start spots (one multi-location request, `past_days=2`). On failure it uses the embedded sample (SUNY Purchase, Oct 7–11) for every spot and shows a banner.
- Screens: Sign-in (Google + password), Ride (date tabs + Past; Meet / Route / Weather / Notes / Riders panels; share, calendar, edit), Plan (spot comparison → route → preview that reuses the ride panels; autosaved draft), Settings (panels, incl. Users with invite and reset links). A View / Edit / Admin switcher and a "Sign-in screen" link sit below the top bar.
- Prototype-only: everything you change lives in this browser or this session; sample rides, riders, messages and past rides are examples. Not in the prototype: the `/privacy` link on the sign-in page (the page itself is `public/privacy.html`), deleting users, NWS alerts, metric display (the Units choice is saved, values stay imperial), Spots management, kit chart editing, disabling users, message edit/delete, notifications, the 30 s refresh, recorded weather (past rides use sample values).
- Without Leaflet (offline/CDN blocked) maps fall back to an SVG route outline.

## Data sources
- **Forecast and recorded weather:** Open-Meteo (free, no key), hourly, `best_match` (NOAA GFS and HRRR for the US); `past_days=2` supplies the recent rain for road wetness and the recorded weather for past rides. The Worker fetches all spots in one request (10-second timeout) and caches each spot's forecast in KV for 30 minutes. If Open-Meteo fails, each spot keeps its last good forecast for up to 6 hours and a spot without one shows "No forecast" while the others still work; a failed refresh is retried after the next 30 minutes, not on every request. Plan never waits on the forecast.
- **Alerts:** NWS active alerts by point (`api.weather.gov/alerts/active?point=lat,lng`, no key; NWS requires a `User-Agent` with a contact, `BBT Ride (info@bbt.team)`), cached per spot in KV for 10 minutes (5-second timeout, same fallback). Radar: link to RainViewer.
- **Map tiles:** OpenStreetMap (light) and CARTO (dark), loaded by the browser; tile requests send the site's origin as Referer (the site's default is no referrer), as OpenStreetMap's tile policy asks.
- **Routes:** RideWithGPS. Public route JSON (`/routes/{id}.json`) needs no key; private routes and listing the captain's own routes use the API key and auth token (Worker secrets). The club's routes come from the seed data. The exact list endpoints are confirmed against the live API on first deploy; a pasted route link always works.

## Secrets
Never in the repo, the built assets, or any response to the browser. All third-party calls that need a credential go through the Worker.

| Secret | Where it lives | Used by |
|---|---|---|
| `RWGPS_API_KEY`, `RWGPS_AUTH_TOKEN` | Cloudflare Worker secrets (`wrangler secret put …`) | Worker → RideWithGPS |
| `GOOGLE_CLIENT_ID` (not secret), `GOOGLE_CLIENT_SECRET` | Worker variable / Worker secret | Google sign-in |
| `SESSION_SECRET` (random 32 bytes) | Worker secret | Better Auth's `secret` (signs cookies and OAuth state) |
| `BETTER_AUTH_URL`, `BOOTSTRAP_ADMIN_EMAIL` (not secret) | Worker variables | Auth base URL (`https://ride.bbt.team`); first Admin |
| `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (`mailto:info@bbt.team`) (not secret), `VAPID_PRIVATE_KEY` | Worker variables / Worker secret | Web Push notifications |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub repository secrets (Actions deploy) and your local `.env` (Wrangler commands) | `wrangler deploy`, D1 migrations, secrets |

- Local development: Worker secrets in `.dev.vars`, Cloudflare credentials in `.env` (both git-ignored); `.dev.vars.example` lists the names (values empty except the local `BETTER_AUTH_URL`).
- Verified 2026-10-12 with `wrangler secret list`: `GOOGLE_CLIENT_SECRET`, `RWGPS_API_KEY`, `RWGPS_AUTH_TOKEN`, `SESSION_SECRET` and `VAPID_PRIVATE_KEY` are set on the `bbt-ride` Worker. `RWGPS_API_SECRET` is also set but unused (RideWithGPS needs only the key and token); it can be deleted.
- Worker secrets are write-only: once set, Cloudflare never shows them again; rotate by running `wrangler secret put` with the new value.
- The browser calls `/api/routes/:id` and `/api/routes?q=`; the Worker adds the RWGPS credentials and caches results in D1 `route_cache` (refreshed weekly). Route search lists the library (the club's routes from the seed data plus the captain's own routes); the scheduled job fetches library routes not seen yet.

## Architecture
- Cloudflare Worker + static assets (React + TypeScript + Vite, `@cloudflare/vite-plugin`) on ride.bbt.team. Code: `worker/` (API), `src/` (React app), `shared/` (weather, kit, ride math and API types used by both), `migrations/` (D1), `public/` (privacy page, service worker, icons).
- Worker routes: `/api/auth/*` (Better Auth) and `/api/*` (the app's JSON API, Hono); everything else is static assets (the app shell, `/privacy`). See Users and roles for the checks.
- D1: the tables in Data model. KV: forecast and NWS alert cache.
- Scheduled job (Cron Trigger, every 3 hours), one task after another: saves recorded weather on rides whose window has passed (from the cached forecast's past hours), syncs the captain's RWGPS routes, then fetches up to 10 library routes (a route that fails is retried a week later), staying well inside the free plan's 50 outbound requests per run.
- Push: sent from the Worker with a Web Crypto-based Web Push library, in the background (`waitUntil`); a subscription the push service reports gone (404/410) is deleted.
- Backups: D1 Time Travel (restore to any minute in the last 7 days on the free plan).
- Deploys: GitHub Actions on merge to `main` (`.github/workflows/deploy.yml`): lint, typecheck, tests, build, `wrangler d1 migrations apply --remote`, then `wrangler deploy`, using the repository's Cloudflare secrets. `ride.bbt.team` is attached once by hand in the Cloudflare dashboard. Pushes to other branches run the same checks without deploying (`ci.yml`); a pull request shows those results.
- Tests: unit tests for the shared algorithms (the worked examples in this document), password hashing, route simplification, the Web Push payload and the per-spot weather cache; `scripts/smoke.ts` (API checks) and `scripts/ui-smoke.ts` (browser checks) run against the local dev server.

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
