# BBT — Design

Status: **v1 deployed** at app.bbt.team (see README for running it); decisions in `DECISIONS.md`. **v2 steps 1–3 (any sport on the web; calendar link and per-sport notifications; the Android app) built**, then tester feedback, History, New and unread markers, the Team directory with contacts, @mentions and deleting activities (2026-10-14), Garmin help, private activities, announcements and virtual meet-ups (2026-10-15), message threads, the compact activity page, date polls and message notifications with @here (2026-10-17); the iPhone app waits on the Apple fee — see [v2](#v2-any-sport-and-phone-apps-designed-2026-10-13). Where a v1 section and v2 differ, v2 wins. Last updated 2026-10-17.
URL: **app.bbt.team**

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
| **View** (default) | See upcoming and past activities with their weather; RSVP and post messages; the Team directory and contact cards |
| **Edit** | View + plan, publish, edit, cancel and restore activities; add places; delete any message |
| **Admin** | Edit + team settings (sports, defaults, thresholds, kit chart), places, users, and deleting activities |

**How it's built:** [Better Auth](https://www.better-auth.com) (open source, free) runs inside the Worker and stores everything in D1. No outside identity service. Chosen 2026-10-11 over Cloudflare Access (no passwords) and hosted services (extra vendor, user data split from roles). Plugins: **username** (sign in with a username) and **admin** (roles `view` / `edit` / `admin`, default `view`; disable = ban; delete; revoke sessions).
- **Invites:** an Admin enters an email and role in Settings → Users and gets the invite link to send themselves: BBT sends no email (no email service), and the screen says so. **Email it** opens the Admin's own mail app with a ready message to the invited address; **Share…** (phones) sends it by text or chat; the link is also copied. Reset links work the same way. The link (7 days, one use) opens a page offering **Continue with Google** or **set a name, username (optional), mobile phone, emergency contact (optional) and password**, after which the person signs in on the sign-in page (so each request hashes the password once). Either way the account gets the invited role. A Google account can add a password later through an Admin reset link.
- **Who may create an account:** a Better Auth hook allows a new account only when an unexpired, unused invite exists for that email (for Google, the Google account's email). Anyone else gets "Not invited — ask a team admin" and nothing is created. Password accounts are created only through the invite link, never by open sign-up.
- **Passwords:** at least 10 characters; stored as a salted PBKDF2-SHA256 hash (100,000 iterations, the Workers maximum) via Web Crypto, plugged into Better Auth's password `hash` / `verify`. Better Auth's default scrypt can exceed the free plan's 10 ms CPU limit; if PBKDF2 does too, the fallback is Workers Paid ($5/month).
- **Sign-in attempts** are rate-limited by Better Auth (5 per 15 minutes per IP on the sign-in endpoints, counters in D1). No account lockout, so nobody can lock a rider out by guessing.
- **Forgotten password:** an Admin creates a **reset link** (24 hours, one use) in Settings → Users and sends it; the person sets a new password, is signed out elsewhere (and their devices stop getting notifications until they turn them on again), and signs in again. No self-service reset emails in v1. Link tokens travel in request bodies, never in API URLs (which appear in request logs).
- **Usernames:** each account has an email (needed for invites and Google matching); a username is optional, and sign-in accepts either.
- **Sessions:** Better Auth database sessions in an `HttpOnly; Secure; SameSite=Lax` cookie, 30-day expiry renewed daily while in use; no cookie cache, so a role change or disabling takes effect on the next request.
- **Server-side checks:** every `/api/*` route except `/api/health`, the invite/reset link endpoints and the signed calendar feed (`/api/cal/*`) checks the session and role; the UI only hides what the role can't do. Requests that change data must come from the app's own origin (Origin header check), and every input is validated against a schema; messages are capped at 2,000 characters as stored (a mention counts as its stored id) and at 10 mentions; display names are 1–80 characters, have invisible and direction-changing characters removed (the joiners inside compound emoji such as 👨‍👩‍👧 stay), and can't be a label the app shows ("Update", "Former member"); phone numbers must be real phone numbers; push subscriptions must point at a browser push service (Google, Mozilla, Apple or Microsoft push domains); team settings must be consistent (each red threshold beyond its amber one, Drying below Wet) and the kit chart has exactly seven bands, each colder than the one above. Validation errors come back as a readable message. Better Auth's own admin endpoints (`/api/auth/admin/*`: impersonation, setting passwords) and its username-availability check (it would tell anyone who's on the team) are blocked; the app's user management calls them on the server, with its checks and audit log. Riders (View) can open the routes of rides but can't search the library or look up new RideWithGPS routes, which would spend the captain's credentials. **HTTPS only:** Cloudflare's Always Use HTTPS redirects plain HTTP, and the API refuses any plain-HTTP request as a backstop (local development aside); every call the app and Worker make is https; the Android app allows no cleartext; the calendar's Apple and Google buttons use `webcal:` links (kept for simplicity, 2026-10-14; calendar apps should fetch them over HTTPS, see SETUP.md → 9). Static pages and the API send HSTS for a year covering every bbt.team subdomain (`includeSubDomains`, served on `bbt.team` itself by the home page; no preload list). Static pages carry a Content-Security-Policy, `frame-ancestors 'none'` and `Referrer-Policy: no-referrer` (`public/_headers`); API responses get Hono's secure headers and `Cache-Control: no-store` (they carry names and phone numbers), except the calendar feed.
- **Bootstrap:** while no Admin exists, the hook treats `BOOTSTRAP_ADMIN_EMAIL` (a Worker variable) as an Admin invite.
- **Public pages: sign-in, the invite and reset link pages, `/privacy` and `/download/` (the Android app page and APK, no team data).** The link pages work only with a valid token (the invite page shows the invited email). The app's code and styles are public static files (they contain no team data); everything the app shows comes from `/api/*`, which requires a session (except the signed calendar feed, v2), so a shared link opens the sign-in page first. `/privacy` (`public/privacy.html`, linked from the sign-in page) is required by Google to publish the sign-in app. The `workers.dev` address and preview URLs are turned off.
- **Google data kept:** name, email and the Google account ID only. The profile photo and Google's access and refresh tokens are discarded (sign-in needs nothing after the first exchange).
- **Audit:** `audit_log` records who published, changed, cancelled, restored and deleted activities, changed places, settings and users, created or revoked invite and reset links, and deleted other people's messages, and when. The History panel (v2) shows an activity's create, change, cancel and restore rows; the rest is read with `wrangler d1 execute`.
- **Deleting an account** also removes the person's email from old invite/reset links and the audit trail, and with the account their phone and emergency contact, devices, calendar link, muted sports, thread follow and mute choices and visit marks. Signing out turns off notifications on that device. The scheduled job deletes expired sessions and links, finished sign-in attempts, and rate-limit counters older than a day.

### Data model (D1)
Better Auth's tables are generated from its configuration (`scripts/auth-schema.ts` → `0001_auth.sql`); ours are plain SQL migrations. Every reference to a user is `ON DELETE CASCADE` (sessions, accounts, RSVPs, drafts, push subscriptions, a user's reset links, muted sports, calendar link, visit marks) or `ON DELETE SET NULL` (authorship of activities, messages, settings, invites, audit entries). This block is the v1 schema; v2 renames and additions are under [v2 → Data model changes](#data-model-changes).
```
-- Better Auth (generated): user (+ username, displayUsername, role, banned, banReason, banExpires; + phone, emergency_name, emergency_phone, v2), session, account, verification, rateLimit
links(token_hash PRIMARY KEY, kind CHECK(kind IN ('invite','reset')), email, role NULL, user_id NULL, created_by NULL,
      created_at, expires_at, used_at NULL)                     -- invite (7 days) and reset (24 h) links; only a SHA-256 of the token is stored
settings(key PRIMARY KEY, value_json, updated_by NULL, updated_at)   -- one row per setting
kit_bands(id, min_feel_f, name, items_json)                          -- editable kit chart, ordered by min_feel_f
spots(id, name UNIQUE, lat, lng, maps_url, note, archived DEFAULT 0, created_at)
rides(id, date, meet_time, spot_id, pace_mph, notes, observed_json NULL, status CHECK(status IN ('published','cancelled')),
      created_by NULL, updated_by NULL, created_at, updated_at)   -- v1: UNIQUE(date) WHERE status = 'published' (dropped in v2)
ride_routes(ride_id, sort, label, rwgps_route_id, stop_poi NULL, PRIMARY KEY(ride_id, sort))  -- stop_poi = name of the route's POI
route_cache(rwgps_route_id PRIMARY KEY, name NULL, json NULL, in_library DEFAULT 0, fetched_at NULL)  -- in_library = listed in route search
drafts(user_id PRIMARY KEY, form_json, updated_at)                 -- editor autosave (the form says which ride it edits)
rsvps(ride_id, user_id, status CHECK(status IN ('in','out')), route_label NULL, updated_at, PRIMARY KEY(ride_id, user_id))
messages(id, ride_id, user_id NULL, parent_id NULL, kind CHECK(kind IN ('user','update','cancel','restore')) DEFAULT 'user',
         body, created_at, edited_at NULL, deleted_at NULL)       -- parent_id = reply to; kind 'update' etc. = "Ride update" posts;
                                                                  -- user_id NULL on a 'user' message = former member
push_subscriptions(endpoint PRIMARY KEY, user_id, keys_json, created_at)  -- one row per device that opted in
audit_log(id, user_id NULL, action, entity, entity_id, diff_json, at)
```
The ride page's "Updated Sat 9:12 PM · …" note is the latest `kind = 'update'` message, so there is no separate updates table.

## v1 scope
The ride-only first version, kept as the base the v2 section builds on. Statements v2 changed are marked *(v2: …)*.

### Rides (home)
- Editor plans a ride on **any date** (weekend or weekday): date, meet time, start spot, avg pace, notes, and one route or two (main and alternate). Publish (form autosaves; see Plan a ride).
  - Usually one route; occasionally a labeled alternate (e.g., "Full" / "Short") sharing the same spot and time.
- Home shows upcoming rides as date tabs: this Saturday and Sunday always, plus any other upcoming day that has a ride (published or cancelled). The tab carries the date; the page doesn't repeat it. *(v2: one upcoming list with sport filters.)*
- Ride page = warnings (only when something needs attention) + a stack of collapsible panels. Each collapsed header is the briefing; tapping it expands detail. Open/closed state is remembered per rider; panels start open on desktop.
  - **Meet** — collapsed: meet time · spot name (links to Google Maps). Expanded: estimated time back (moving + regroup buffer + coffee stop, and the time without the stop), parking notes, Open in Google Maps, and "+ Calendar", which opens a picker: Google Calendar, Apple Calendar (.ics), Outlook.com, Outlook (work or school), Other (.ics). The .ics file is generated in the browser (an iPhone Home Screen app doesn't share its sign-in with Safari, so a server link wouldn't work there); event = meet → back, location = the parking pin's coordinates (so calendar apps open the pin in Maps and car navigation can route to it; .ics also carries GEO), and the spot's name and Maps link, parking notes, routes and notes in the description.
  - **Route** — collapsed: route name (opens RWGPS) · distance · climbing, plus the Full/Short switcher. Expanded: map, elevation profile, coffee stop (see below), "Open in RWGPS".
  - **Weather** — collapsed: temp range · real feel range · wind · rain chance, and a one-line kit hint. Expanded: ride-window summary (bike feel, gusts, rain total, roads), hourly table from the whole hour before meet time to 3 h after the estimated return, rounded to whole hours (ride window shaded; Sky column uses icons for clear, partly cloudy, overcast, fog, drizzle, rain, showers, snow and thunder, with a moon for clear night hours and the label on hover and for screen readers), a "Full-day forecast" button that opens the rider's chosen weather source (NWS, Weather.com, Windy or Google; choice saved in their browser), then What to wear (Run cold / Avg / Run hot).
  - **Notes** — only if the ride has notes; collapsed shows the first line.
  - **Riders** *(v2: Who's in)* — collapsed: "5 in · 1 out" plus **In / Out** buttons, so riders answer without opening the panel; tapping the selected answer again clears it. The Full / Short choice appears only when the ride has an alternate route and only after tapping In (main route preselected); Out never asks for a route. Expanded: who's in (with their route) and out. *(2026-10-17: the thread is its own **Messages** panel below Who's in, open by default; its header says "12 messages · 3 new", and while closed it previews the latest message. Same component for date polls.)* The message thread for the ride: anyone can post, reply to a message (one level), and see everyone's messages. All signed-in roles can RSVP and post while the ride is upcoming and not cancelled (a cancelled ride's thread stays readable). Authors can edit their own messages while the ride is upcoming and not cancelled, and delete them while it's upcoming; Edit and Admin can delete any message, also on past rides (moderation). The page refreshes RSVPs and messages every 30 s while open.
  - **Share** *(v2: a tile in the action row)*: uses the phone's share sheet (Web Share API) with a text brief (date, meet time and Maps link, routes with RWGPS links, coffee stop, time back, weather, notes) plus the ride link; falls back to a copy-to-clipboard sheet. The ride link requires sign-in.
  - Warnings: wet/drying roads, cold, heat, wind, rain, thunder, low light (meet time within 30 min of sunrise), and **active NWS alerts** at the spot's location (warnings red, advisories and watches amber; see Warnings).
- "Open in RWGPS" works for riders only if the route is public or shared with them; the map and stats render regardless.
- **Coffee / muffin stop (optional)** — a ride can have an optional mid-ride stop.
  - Auto-suggested from the route's RWGPS POIs (`poi_type_name` = `coffee` or `food`, listed first); the editor confirms, picks another POI, or chooses no stop.
  - Route panel shows: name (links to Maps), mile marker, ETA (see ETA math), stop length (team setting, default 20 min; it extends the ride window) and an "optional" label. No separate stop forecast.
- **Past rides** — a **Past** tab after the date tabs on the Ride page (all roles) *(v2: a Past activities link on Home)*. Newest first, grouped by month; each row shows date, start spot, route(s), how many rode, and the recorded conditions at meet time (temp, real feel, wind, roads), with a red "Cancelled" tag where it applies. A search box filters by route or spot. The list shows the latest 200 rides.
  - Opening a past ride shows the same panels, read-only: Meet and Route as published, **Weather = recorded at meet time** (temp, real feel, wind and gusts, rain, roads and sky from Open-Meteo's past hours for the spot, saved after the ride window has passed, not the old forecast; same algorithms, so roads come out the same way; no hourly table or kit), Notes, and Riders (who rode, who was out, and the full message thread; RSVP and posting are off).
  - Editors get **Reuse this plan**, which copies the ride into Plan on that same default day.
  - Data: no new tables. A ride is past once its date has passed; recorded weather is stored with the ride (`rides.observed_json`), written by a scheduled Worker job every 3 hours for published rides up to two days old (Open-Meteo's past hours reach back two days; a ride the job misses, or a cancelled one, shows no conditions). Past activities are kept; only its creator or an Admin can delete an activity (v2 → Deleting an activity).
  - Only the recorded weather is frozen. The route (distance, map, coffee stop) comes from RideWithGPS as it is now, and times use the current team settings, so editing a route on RWGPS also changes its past rides (decided 2026-10-12; keeps the data model simple).

### Spots
- Fields: name, location (lat/lng), Google Maps link, parking notes (where to park, restrooms). Name and link are required *(v2: notes optional; called Places in the app)*.
- **Add (Edit and Admin):** "Add a start spot" at the bottom of Plan's spot list. Enter a name, paste a Google Maps link (drop a pin on the parking spot → Share → Copy link) or plain coordinates, and parking notes; Save selects the new spot. Spot names must be unique.
  - The Worker reads the pin from the link on save, pin first: `!3d<lat>!4d<lng>`, then `q=` / `query=` / `/search/<lat>,<lng>`, then `@lat,lng` (that one is the map's centre, so it's the last resort). Short `maps.app.goo.gl` links are followed one redirect (only from that host). The pasted Google Maps link is kept as the spot's link; anything else gets a coordinates link.
  - The app reloads the forecast after saving, which fetches it for the new point.
- **Manage (Admin):** the **Places** panel in Settings lists each spot (name and parking notes) with **Open in Maps** (to check the pin), **Edit** (the same three fields in place; paste a new link to move the pin) and **Archive**, plus **Add place**. Archived spots drop out of the pick list but stay on past rides and on upcoming rides that already use them (which keep their forecast and recorded weather); they sit in a collapsed Archived list with Restore.

### What to wear
- Team kit chart keyed on **bike feel**, with add-ons for rain, wind, wet roads and thunder, and a shedding hint (see Kit chart); Admins edit it in Settings.
- Per-rider offset (runs cold / avg / hot, ±5°) stored in that rider's browser.

### Settings (Admin only, stored in D1)
Team settings live in D1 (`settings`, `kit_bands`, `spots`) and are edited on the Settings page (gear icon). Fixed by design, not settings: low light = meet time within 30 min of sunrise, wind-vest add-on at 12 mph, shedding hint at 8°, pace 10–25 mph (run 4–12 mph, i.e. 5:00–15:00 min/mi). Collapsible panels in a single column (so opening one never leaves a gap beside it), each with a one-line summary of the current values:
- **Users:** invite by email with a role (copy invite link), change roles, disable, create a password reset link, delete on request; shows each user's sign-in methods. Disabled members get no notifications, are hidden from Team and the mention list, and their calendar link stops working. A short line explains what each role can do. Deleting removes the account, sign-in methods, sessions, push subscriptions, drafts, RSVPs, contact details, calendar link, muted sports, thread follow and mute choices and visit marks; the person's messages stay on past rides as "Former member".
- **Ride defaults:** meet time **8:30**, weather window 3 h (used before a route is picked), pace 17 mph, coffee stop **20 min** (typical 15–20), regroup buffer **5 %** of moving time.
- **Road wetness:** look-back hours, Wet / Drying film thresholds.
- **Sports** *(v2)*: which sports Plan offers.
- **Weather warnings:** amber and red thresholds for cold (bike feel), heat (real feel), wind, gusts, rain chance, rain amount *(v2: one weather group at a time)*.
- **Kit chart:** each band's lower bound, name and items (`kit_bands`); the seven bands are fixed in number.
- **Places:** list with Open in Maps, Edit and Archive; Add place (see Spots).
- **Reset to defaults** restores the first-run values (not users or spots).

Team settings are stored in imperial units. Per-person preferences stay in the browser: theme and **units** (imperial by default; metric shows °C, km/h, km, m, mm), both in the account menu, Run cold / Avg / Run hot, weather source, which panels are open and the last sport planned. Notifications are per device and muted sports per person, both kept on the server.

### Plan a ride (Edit and Admin)
Planning is one top-to-bottom flow in the same panel style, mirroring the ride page. There is no separate Weekend page. Plan opens from the calendar-plus icon in the top bar, on the first weekend day in the coming week that has no ride yet (otherwise this Saturday). The form opens straight away; the forecast fills in when it arrives.
1. **Meet:** Sat / Sun buttons *(v2: one Date field with weekend chips)* or any date from today on (the app's own date picker: weeks start on Monday, weekends shaded), meet time, then the **start spot**: a compact pick list, one row per spot: name, temp · real feel · wind · rain for the weather window, and warning chips only when something needs attention. Tap a row to select it. The selected spot gets a collapsed **Details** panel below: bike feel, gusts, rain and road state; rain bars −12 h → +8 h; hourly table (same range as the ride page); Full-day forecast and Radar; parking notes and Google Maps. The weather window is the default length (Settings) until a route is picked, then the route's actual ride time. Below the list is **Add a start spot** (see Spots).
2. **Route:** routes that start at the chosen spot are listed first ("starts here"), then the captain's RWGPS library and the BBT club library via search, or a pasted RWGPS link (a link that can't be loaded, e.g. a private route, says so); a picked route shows an Open in RWGPS link; a note appears if the route starts away from the spot. Optional alternate route with labels, coffee stop from the route's POIs, pace (10–25 mph). Picking a route first (before a spot) selects its nearest spot.
3. **Notes.**
4. **Preview:** the actual ride-page warnings and panels for the draft, then **Publish**.

Drafts and changes:
- **No Save draft button.** The form autosaves per editor (`drafts` table) once something is changed, so a half-planned ride survives closing the page; just opening a ride to edit or reuse leaves the saved draft alone. "Start over" clears it.
- If a ride is already posted for the chosen date, the button reads **Replace ride** with a note *(v2: several per day; Publish another or Replace)*. Replacing cancels the old ride (it keeps its RSVPs and messages in history, and its riders get a "Ride cancelled" notification) and publishes the new one.
- **Editing a published ride:** editors get an Edit (pencil) icon on the ride page, next to Share. It opens Plan pre-filled with an "Editing the Sat, Oct 10 ride" bar, and the button reads **Update ride**. "Discard changes" leaves the published ride untouched. If someone else changed the ride after it was opened (another editor, or an old restored draft), **Update ride** is refused with "Someone changed this ride after you opened it" rather than overwriting their change ("Someone changed this after you opened it. Discard your changes and edit it again.").
  - RSVPs and messages are kept (moved along if the date changes). A route choice on an RSVP is cleared if that alternate is removed or relabelled. Past rides can't be edited.
  - If something riders care about changed (date, meet time, start spot, route, coffee stop, notes), the ride page shows "Updated Sat 9:12 PM · meet 8:30 → 9:00 AM" and the same text is posted to the Riders thread as a "Ride update" message.
  - **Cancel ride** marks it cancelled without deleting it: a red "Ride cancelled" banner on the ride page, a "Ride cancelled" message in the thread, and "CANCELLED:" at the start of the shared text. Editing a cancelled ride keeps it cancelled; only **Restore ride** undoes it.

### Notifications (v1)
*(v2 adds New activity posted, mentions, Deleted, new messages and @here; see v2 → Notifications and Message notifications.)*
- Only when a published ride is **updated** (any change that shows the "Updated" note) or **cancelled / restored**. No notifications for chat messages or replies; no RSVP reminders or deadlines.
- **Who:** every member who turned ride notifications on, on each device they did, whether or not they've answered In / Out (disabled members get none).
- **Web Push only** (decided 2026-10-11; no email service). Riders opt in from the account menu on each device; on iPhone that requires adding the app to the Home Screen (iOS 16.4+). The Worker sends the push on Update ride / Cancel ride / Restore ride (and on Replace, for the replaced ride) using VAPID keys. Tapping a notification opens the ride. Riders without push see the "Updated" or "Cancelled" note and the thread message when they open the ride.

### Platform
- Mobile-first, installable PWA; desktop uses multi-column layout of the same views.
- **Real feel** is the standard apparent temperature; **bike feel** is defined under Algorithms.

## Brand
Source files in `brand/` (color sheet, logo .ai/.svg/.pdf, favicon). Web-ready versions in `brand/web/`:
- `bbt-logo.svg` — full bike logo: the top bar, the app icons and the Android notification icon (5 KB; source SVG was 948 KB due to an embedded ICC profile).
- `bbt-wordmark.svg` — "bbt" wordmark, the source of `public/favicon.svg` (1 KB).
- `ridewithgps-vertical-logo.svg` — RideWithGPS's own logo, for the RideWithGPS tile (supplied by the team).
The BBT files use `fill="currentColor"` so they can switch between navy, white, and orange.

| Name | sRGB | Use |
|------|------|-----|
| BBT Light Blue | `#0077D1` | Top bar; primary buttons (white text, 4.6:1 AA). Links on light use the darker `#0067B5`; links and outline buttons on dark use `#4DA3FF` |
| BBT Orange | `#FF3115` | Accent only: stripe under top bar, active tab underline. Not used for buttons |
| BBT Dark Blue | `#020C2B` | Dark-mode page background |
| Logo navy | `#03144D` | Primary text on light; dark-mode cards |
| BBT Transition Blue | `#041DB2` | Charts (rain bars, elevation profile) in light mode; dark mode uses `#7FB2FF` |

- **Top bar** (the only navigation; there is no tab row): white bike logo on the left, which is the way home to Ride; on the right, **Team** (people icon, everyone), **Plan** (calendar-plus icon) and **Settings** (gear) for roles that have them (icons only on phones, icon + label on wider screens), then an **account button** with the user's initial. View members see the logo, Team and the account button. The account menu shows name (with **Edit name**: 1–80 characters, shown to the team; Google sign-ups start with their Google name), role and sign-in method; **My contact info** (phone and emergency contact); **Theme** (Auto / Light / Dark); **Units** (°F · mi / °C · km); **Notifications** (on/off for this device); **Tell me about new** (one toggle per sport, for new-activity notifications); **Calendar link** (Get my calendar link, then Apple Calendar · Google Calendar · Copy link · Reset link); **Install on Android / iPhone** (in phone browsers); **Help** (Routes on your Garmin); and **Sign out**. Logo `bbt-logo.svg`, ~32px tall, on Light Blue, with a 4px orange stripe directly underneath (no separator). Same bar in light and dark mode; checked on a phone 2026-10-11, no hairline needed. No text next to the logo.

- Warnings use amber and red tinted pills and boxes (icon + label), never brand orange. There is no green "Go" state; a clean forecast shows nothing.
- Light and dark mode both supported; dark mode is navy-based, not gray.
- App icons are rendered by `npm run icons` (scripts/icons.ts): the full bike logo on Light Blue for the PWA (180/192/512, also the Web Push notification icon) and the Android launcher icons (the Android splash screen is the blue with the same logo, `drawable/splash.xml`). The favicon stays the wordmark, which reads at 16px.

## Algorithms
All inputs are Open-Meteo hourly values in °F, mph, inches, local time (America/New_York). `precipitation` at hour *h* is the total for the hour ending at *h*. Values between hours are linearly interpolated (wind direction, weather code and rain chance use the nearest hour). Implementation: `shared/weather.ts` (`roadAt`, `bikeFeel`, `evaluate`), `shared/kit.ts` (`kitAdvice`), `shared/ride.ts` (`rideTimes`).

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
The v1 clickable prototype (`prototype/`, a single HTML file) was the spec for v1. It predated v2 and was removed on 2026-10-14 once the app and this document replaced it; it remains in git history. Design canvases for later features are private artifacts.

## Data sources
- **Forecast and recorded weather:** Open-Meteo (free, no key), hourly, `best_match` (NOAA GFS and HRRR for the US); `past_days=2` supplies the recent rain for road wetness and the recorded weather for past rides. The Worker fetches all spots in one request (10-second timeout) and caches each spot's forecast in KV for 30 minutes. If Open-Meteo fails, each spot keeps its last good forecast for up to 6 hours and a spot without one shows no forecast while the others still work; a failed refresh is retried after the next 30 minutes, not on every request. Plan never waits on the forecast.
- **Alerts:** NWS active alerts by point (`api.weather.gov/alerts/active?point=lat,lng`, no key; NWS requires a `User-Agent` with a contact, `BBT (info@bbt.team)`), cached per spot in KV for 10 minutes (5-second timeout, same fallback). Radar: link to RainViewer.
- **Map tiles:** OpenStreetMap (light) and CARTO (dark), loaded by the browser; tile requests send the site's origin as Referer (the site's default is no referrer), as OpenStreetMap's tile policy asks.
- **Routes:** RideWithGPS. Public route JSON (`/routes/{id}.json`) needs no key; private routes and listing the captain's own routes use the API key and auth token (Worker secrets). The club's routes come from the seed data. The exact list endpoints are confirmed against the live API on first deploy; a pasted route link always works.

## Secrets
Never in the repo, the built assets, or any response to the browser. All third-party calls that need a credential go through the Worker.

| Secret | Where it lives | Used by |
|---|---|---|
| `RWGPS_API_KEY`, `RWGPS_AUTH_TOKEN` | Cloudflare Worker secrets (`wrangler secret put …`) | Worker → RideWithGPS |
| `GOOGLE_CLIENT_ID` (not secret), `GOOGLE_CLIENT_SECRET` | Worker variable / Worker secret | Google sign-in |
| `SESSION_SECRET` (random 32 bytes) | Worker secret | Better Auth's `secret` (signs cookies and OAuth state) |
| `BETTER_AUTH_URL`, `BOOTSTRAP_ADMIN_EMAIL` (not secret) | Worker variables | Auth base URL (`https://app.bbt.team`); first Admin |
| `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (`mailto:info@bbt.team`) (not secret), `VAPID_PRIVATE_KEY` | Worker variables / Worker secret | Web Push notifications |
| `FCM_SERVICE_ACCOUNT` (key of a service account limited to sending notifications) | Worker secret | Worker → Firebase (Android app notifications) |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `GOOGLE_SERVICES_JSON` | GitHub repository secrets | Deploy's android job (`scripts/build-apk.sh`) |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub repository secrets (Actions deploy) and your local `.env` (Wrangler commands) | `wrangler deploy`, D1 migrations, secrets |

- Local development: Worker secrets in `.dev.vars`, Cloudflare credentials in `.env` (both git-ignored); `.dev.vars.example` lists the names (values empty except the local `BETTER_AUTH_URL`).
- Setting, checking and rotating them: SETUP.md. Worker secrets are write-only: once set, Cloudflare never shows them again.
- The browser calls `/api/routes/:id` and `/api/routes?q=`; the Worker adds the RWGPS credentials and caches results in D1 `route_cache` (refreshed weekly; a route RideWithGPS doesn't return is retried after an hour). In Plan, a route is looked up by ID only from a full RideWithGPS link. Route search lists the library (the club's routes from the seed data plus the captain's own routes); the scheduled job fetches library routes not seen yet.

## Architecture
- Cloudflare Worker + static assets (React + TypeScript + Vite, `@cloudflare/vite-plugin`) on app.bbt.team. Code: `worker/` (API), `src/` (React app), `shared/` (weather, kit, ride math and API types used by both), `migrations/` (D1), `public/` (privacy and download pages, service worker, icons), `android/` + `native/www/` + `capacitor.config.ts` (the Android app), `scripts/` (smoke tests, seed data, icons, APK build).
- Worker routes: `/api/auth/*` (Better Auth) and `/api/*` (the app's JSON API, Hono); everything else is static assets (the app shell, `/privacy`, `/download/`). See Users and roles for the checks.
- D1: the tables in Data model. KV: forecast and NWS alert cache, Firebase access token. Queue: notifications.
- Scheduled job (Cron Trigger, every 3 hours), one task after another: saves recorded weather on rides whose window has passed (from the cached forecast's past hours), syncs the captain's RWGPS routes (all pages), fetches 2 library routes (a route that fails is retried a week later), then deletes expired records. Two routes per run stays well inside the free plan's limits (50 outbound requests and about 10 ms of CPU per run), so the seeded library takes about 2.5 days to fill.
- Push: a change puts the notification on a Cloudflare Queue (`bbt-ride-push`) in batches of up to 5 devices; the Worker's queue consumer sends one batch per run (Web Crypto-based Web Push library), so each run stays inside the free plan's ~10 ms of CPU (encrypting and signing takes about 1–2 ms per device) and 50 outbound requests whatever the number of devices, and delivery doesn't depend on the request that made the change. A subscription the push service reports gone (404/410) is deleted; any other failure (network, rate limit, a push service error) is logged with its status and that device alone is re-queued once, a minute later. Each person keeps their newest 10 devices. Each device re-registers when the app opens (the browser's subscription as well as the Android app's token), and the service worker registers a subscription the browser replaces (`pushsubscriptionchange`), so the switch can't show on while the Worker has no subscription.
- Backups: D1 Time Travel (restore to any minute in the last 7 days on the free plan).
- Deploys: GitHub Actions on merge to `main` (`.github/workflows/deploy.yml`): the CI checks (`ci.yml`: lint, typecheck, tests, build), then, in parallel, the android job (`scripts/build-apk.sh`, only once its signing secrets exist; it never sees the Cloudflare token), and the deploy job: build, add the APK (this run's, or else the published one), `wrangler d1 migrations apply --remote` and `wrangler deploy`; only the two Wrangler steps get the repository's Cloudflare secrets. Actions are pinned to commit SHAs; Node 22 (`.nvmrc`). A column rename breaks the old Worker for the minute between migration and deploy; the app shows a Reload screen if an open page meets the new API. `app.bbt.team` is attached once by hand in the Cloudflare dashboard. Pushes to other branches run the same checks plus an unsigned Android build, without deploying (`ci.yml`); a pull request shows those results.
- Tests: unit tests (`test/`) for the shared algorithms (the worked examples in this document), settings and sports rules, activity input, New York time, the .ics calendar (including a CPU budget for a 100-event feed), password hashing, route simplification, the Web Push payload, Firebase signing and delivery, the per-spot weather cache, Google Maps links, links in text, weekend date chips, phone numbers and contact details, and mentions; `scripts/smoke.ts` (API checks) and `scripts/ui-smoke.ts` (browser checks) run against the local dev server.

## v2: any sport and phone apps (designed 2026-10-13)
Everything above is v1. Steps 1–3 below are built; where they differ, this section wins (e.g. `rides` is now `activities`, "Ride update" posts are now "Update", and a cancelled activity says "Cancelled"). v2 turns BBT Ride into **BBT**: the same team plans rides, runs, swims, pickleball, ski days and anything else, and the app gets an Android version with native notifications. The iPhone keeps the Home Screen web app until a native iPhone app is paid for (Apple's $99/year, or a nonprofit fee waiver). Design canvas: the private "BBT Multi-Sport Prototype" artifact (seven phone screens). Decisions: `DECISIONS.md` → v2.

### What changes for people
- **Name:** the app is called **BBT** (app name, page title, icons). The address is `app.bbt.team`. The app and notification icon is the full bike logo on Light Blue.
- **Sports:** Ride, Run, Swim, Triathlon (added 2026-10-14), Pickleball, Ski and Other. Admins turn sports on or off for the team (Settings → Sports); Plan offers only the ones that are on, plus Other (with its own title). No custom sports beyond Other.
- **Triathlon:** a race event like Swim: race start and end (3 h by default), a place (the transition area), details such as "Sprint · wave 3 at 7:40", always outdoors, no route; weather uses the Other outdoor thresholds. On for the team by default.
- **New and unread** (2026-10-14, design K1): Home marks what's new to each person since they last opened it. On the sport icon, a blue dot (new or changed) or a count (other people's new messages, 9+); under the place, one blue reason line: "New · posted by Jo Park", "Changed: meet 8:00 → 8:30 AM" (or Cancelled / Back on), "3 new messages · Sam, Jo", joined with " · " when several apply. Inside the activity: "Changed since you last looked · …" replaces the "Updated" note, Who's in's summary says "· 3 new", and a "3 NEW" divider sits before the first unread message. Your own posts, changes and messages never count. Opening the activity page records the visit, once per opening (`POST /api/activities/<id>/seen`; reading an activity elsewhere, as Plan and the 30 s refresh do, doesn't count), in `activity_seen`, per person and activity, so it clears on every device; before a person's first visit, their baseline (`seen_baseline`, set when markers started or when they first used them) stands in, so what already existed counts as seen. That call's reply gives "last caught up" (`seenBefore`, the later of the previous visit and the person's own last change). Visit marks go with the activity or the person; they're never shown to anyone else.
- **Activity history** (2026-10-14): a quiet **History** panel, closed by default, at the end of the activity page (after Who's in) and under the buttons on the Edit screen. No card fill or shadow, smaller grey text. Its one line: who created it and when, plus "changed by" the latest editor. Opened, it lists, newest first, who created it and each change, cancellation and restore with date and time, an update with what changed (the update note). It's built from `activities.created_by/created_at` and the audit log, so existing activities have it too; a cancellation by Replace (no audit row of its own) shows from its note; a deleted account shows as "Former member". Visible to every member; at most 50 lines.
- **Team and contacts** (2026-10-14, designs A + C): every account has a mobile phone (required) and an emergency contact (name and phone, optional; both or neither). New password accounts give them on the invite page; Google accounts and members from before contacts get a one-time "One more thing" screen, and the app (not the API) waits for a phone before anything else. **My contact info** in the account menu changes them. Phones are stored as "+" and digits; US numbers may be typed any common way and show as (914) 555-0142. The **Team** icon in the top bar (everyone) opens the directory: everyone not disabled, by name (no roles: Admins see them in Settings → Users, 2026-10-16), search once there are more than six, and Call and Text on each row (icon buttons named "Call Jo Park" / "Text Jo Park"); your own row has Edit. Tapping a name, in Team or in Who's in, opens the **contact card**: Call and Text (the phone's own apps, `tel:` and `sms:` links, which the Android app hands to the phone), and the emergency contact with its own Call. Every member sees everyone's phone and emergency contact; roles aren't shown in Team or on contact cards, only to Admins in Settings → Users (the captain's calls, 2026-10-14 and 2026-10-16; `GET /api/team` returns no roles). It also returns disabled members, name only, so mentions of them still show their name; the app leaves them out of Team, cards and the mention list. Usernames stay a sign-in option only; the app shows names.
- **Mentions** (2026-10-14): typing **@** in a message, reply or edit opens a list of up to six teammates (never yourself, never disabled members) matching what follows (first letters of each name, so "@jo pa" finds Jo Park); Up/Down and Enter, or a tap, picks one, and the box shows "@Jo Park". The message stores `<@userId>` (only a name picked from the list becomes one, and "@Jo" never matches inside "@Joanna"), so a mention follows a rename; it shows as a highlighted "@Name" (filled when it's you; "@Former member" for a deleted account). At most 10 people per message. The mentioned people get a notification when the message is posted, "Sam mentioned you · Armonk ride" with its first 300 characters, even if they muted the sport or aren't going; never the author. Editing a message never notifies, so nobody can be pinged again and again.
- **Help** (2026-10-15): the account menu has a **Help** heading with **Using BBT** (`/help`: a short tour of the app by task, each section with a button to go and do it; the planning section shows to Editors and Admins, the Settings one to Admins) and **Routes on your Garmin** (`/help/garmin`), written for people who aren't technical: set up once (RideWithGPS → Settings → Connected Services → Connect with Garmin, Courses on), for each ride (BBT's RideWithGPS tile → Send to Garmin → let Garmin Connect sync → the Courses list), six checks in order with one fix each when a route doesn't arrive, and copying the route over by cable (FIT Course into Garmin/NewFiles). No link on the activity page (the captain's call). Steps follow RideWithGPS's Garmin Connect help article.
- **Deleting an activity** (2026-10-14; creators too since 2026-10-15): its creator (while an Editor) and Admins, from the Edit screen, under Cancel. A sheet asks "Delete “Armonk ride”?", says how many RSVPs and messages go with it, and offers **Delete for everyone**, **Cancel it instead** (while it's published) and **Keep it**. Deleting removes the activity, its routes, RSVPs, messages, visit marks and any editor's autosaved Plan form that was editing it, for good; the audit log keeps a "delete" row with its sport, name, date and time. People going (other than the person deleting it) to an upcoming published one are told ("Deleted: Armonk ride, Sat, Oct 17" · "Removed by Dana."; tapping it opens Home); the sheet says how many. Cancel, Restore and Delete sit outside the preview, so an activity whose route won't load can still be handled. Past activities can't be opened for editing, so the app doesn't offer deleting them (the API would allow it). Cancel stays the everyday choice: it keeps the activity and its thread.
- **Private activities** (2026-10-15, designs on the "Invite-only activities" canvas): Plan ends with **Visibility**: **Public** (the whole team sees it, as before) or **Private** (only the people invited see it). Private shows the people picked as chips (You first, fixed) over a search box and a checklist of active teammates; Publish waits until at least one person besides the creator is picked. A private activity has a small lock in the lower right corner of its icon (Home, History, the activity page and Plan's preview); Who's in adds **Not answered yet** (the people invited who haven't said In or Out) and "Private: only the N people invited see this."; @ only offers the people invited, and the message box says "Message the group".
  - **Who sees it:** only the people invited, the creator among them (added by the server). Admins are no exception: one not invited doesn't see it. Not invited means it doesn't exist for you: not on Home, History, your calendar link, notifications or unread markers, and every request about it (read, open, answer, post, edit or delete a message, change, cancel, restore, delete, Replace) gets exactly the answer it would get for an activity that doesn't exist (404; 403 first where the role isn't allowed at all, 409 for Replace). Each write re-checks this inside its transaction, so someone removed a moment ago can't answer, post or cancel after all.
  - **Who changes it:** the Editors and Admins invited, with the same edit, cancel and restore as for public activities; invited Members answer and post like anyone. Editing shows **Private · N people** with the chips (the creator, marked "created it", and you stay on the list; the server keeps both) and **+ Invite people**. People added are notified ("Dana invited you: Katonah loop", even if they muted the sport); people removed stop seeing it and aren't told, and their answer goes with them (their messages stay). Guest changes aren't announced as "Updated".
  - **Public is one-way:** **Make public** (on Update; the app sends it as an explicit request, and an edit that leaves the guest list out keeps it as it is) shows it to the whole team and tells those following the sport as a new activity, except the people already invited (who get any "Updated" instead); a public activity can't be made private (people may already have seen it or said In).
  - **Replace:** a private plan can't replace a public activity (the team would see theirs vanish for something they can't see); cancel it instead. A public plan can replace a private one the editor is invited to.
  - **Delete:** the creator (while an Editor) or an Admin who can see it; other invited Editors can cancel it. If the creator's account is deleted, the invited Editors still manage it.
  - **Notifications:** a private activity only ever notifies the people invited (enforced where notifications are queued, whatever the reason; an activity that can't be found notifies no one, except the "Deleted" notice to the people who were going). Its "new activity" notification goes to them whatever sports they muted; people just invited get that rather than "Updated".
  - **Data:** `activities.private` and `activity_guests(activity_id, user_id)` (`0014_private.sql`). The server applies one rule, `visible()` in `worker/util.ts`, in every query that reads activities for a person; only notifications about an activity already in hand skip it, and they filter by guest list themselves.
- **Announcements** (2026-10-15, designs on the "Announcements and virtual meet-ups" canvas): Admins post a message to the whole team from **Settings → Announcements**: a title (80 characters), a message (1,000; links are tappable), an optional last day, and **Also send a notification** (on by default; it goes to everyone with notifications on, and tapping it opens the Announcements page).
  - **Banner:** under the top bar on every page (except the Announcements page itself), the newest active announcement the person hasn't tapped **Got it** on, with "1 of N" when there are more. Got it is remembered on the server per person (`announcement_seen`), so it clears on every device. The poster sees it too until they tap Got it. Someone who joins while one is active sees it too.
  - **Active** while not ended and its last day (New York) hasn't passed; without a last day it stays until each person taps Got it or an Admin taps **End now**.
  - **Announcements page** (account menu → Announcements, `/announcements`): the active ones and those from the last 90 days, newest first, with the date, who posted it and its last day.
  - **Admins' list:** Active and Past, each with "18 of 30 got it" (members who aren't disabled); tapping it lists who hasn't, with Call and Text. **Edit** fixes the title, message or last day without showing it again to those who already tapped Got it, and never notifies again; **End now** takes it off the banner (it stays on the page). Posting, editing and ending are audited.
  - **API:** `GET /api/announcements` (everyone), `POST /api/announcements/:id/seen`; Admins only: `GET /api/announcements/all`, `GET /api/announcements/:id/unseen`, `POST /api/announcements`, `PUT /api/announcements/:id`, `POST /api/announcements/:id/end`.
- **Virtual meet-ups** (2026-10-15, same canvas): a place is either a **location** (a Google Maps pin, as before) or **online**: its link is a meeting link (any https address that isn't Google Maps or coordinates; Zoom, Google Meet, Teams and Webex are named, anything else is "Online link"). The place form ("Map or meeting link") says "Online · Zoom · No map or weather. Activities here get a Join button." as soon as it recognises one; Settings → Places marks it "Online · Zoom" with **Open link**. The link and its notes (passcode) are seen by everyone who can see the activity, like any place.
  - **Any sport can be online.** At an online place every sport has a **Start time** and **Ends**; a ride's or run's route is optional (linked from the RideWithGPS tile, for a shared course such as Zwift), with no pace, coffee stop or ETA; it's never outdoors, so no weather check, Weather panel, warnings or recorded weather. Plan's place list says "Online · Zoom · no weather check" and hides Indoor / Outdoor.
  - **Activity page:** the header says "Ride · Online"; **Join** (filled, first) replaces Directions and opens the link (on phones the Zoom, Meet or Teams app opens it if installed; the Android app hands it to the phone); Meet adds "Online: Join on Zoom" and the place's notes. Home and History show "· Online" with a small video icon. Share says "Join: <link>".
  - **Calendar:** an online activity's event has the meeting link as its location and "Join <place>: <link>" in its notes, with no coordinates.
  - **Rules (server):** the app says whether it planned the activity as online and the server checks it against the place (`checkInput`); the input rules follow (`timedByRoute` in `shared/sports.ts`). A place used by upcoming activities can't switch between online and a pin (make a new place instead). Online places get no forecast.
- **What's new** (2026-10-15): dated release notes for members at `/updates/<date>` (e.g. `/updates/2026-10-15`), listed newest first at `/updates` and linked from the account menu (**What's new**). Inside the app on purpose, not on the public site: someone signed out who opens a link is sent to sign in and then back to the update. The notes live in `src/pages/Updates.tsx` (add new ones at the top); an announcement can link to one.
- **Plan, When and Where** (tester feedback, 2026-10-14): one **Date** field (any day) with quick-pick chips for the next four weekend days, replacing the two weekend tabs that set the same value. With 7 or more active places, a search box filters the place list by name and notes; the chosen place always stays listed.
- **Links:** web links (http, https, www.) in notes and thread messages are tappable; nothing else is linked.
- **Sport icons:** Google Material Symbols (Rounded, weight 400; Apache 2.0, license in `brand/licenses/`), copied into the app as SVG paths (`src/lib/icon-paths.ts`, generated by `scripts/sport-icons.ts` from the list in `shared/sport-icons.ts`); nothing loads from Google. Ride `directions_bike`, Run `directions_run`, Swim `pool`, Triathlon (Material has none: ours is its swim, run and bike shapes in a triangle, put together by the script), Pickleball `pickleball`, Ski `downhill_skiing`, Other `pending` (a circle with three dots). For an Other activity, Plan shows an **Icon** grid of 46 (outdoor sports, ball sports, gym and yoga, games: chess (knight), cards, ping-pong, billiards, bowling, and social: meal, drinks, party, meetup, volunteer). Ping-pong is Tabler Icons' (MIT, license in `brand/licenses/`), its strokes turned into filled outlines at Material's weight; Billiards and Bowling are drawn to match (2026-10-15); the editor's pick is stored in `activities.icon` (null shows the sport's own icon; only Other keeps one) and can be changed when editing. Adding a sport later: add it to the list and run the script. www.bbt.team uses the same shapes.
- **Home:** one list of upcoming activities, soonest first. Each row: sport icon, day · time, title, place, **N going** (bold) with a **You're in** tag when the viewer said In (the upcoming list carries each viewer's own answer, `mine`), and warning chips only when something needs attention (no "Good" state, as in v1), on their own wrapping line under the place so they never squeeze the date and title. Sport filter buttons (All, then each sport that has something coming up) appear only when more than one sport is coming up. **Past activities** at the bottom opens today's Past list, now with a sport filter. No day tabs.
- **Activity page:** the v1 ride page, generalised. Header card: sport · indoor/outdoor, title, day · time · details, and the Edit icon for editors. Under it, the **action row** (below). Then panels as in v1, shown only when they apply: **Meet** (place and its notes), **Route** (ride and run only), **Weather** (outdoor only), **Notes**, **Who's in** (In / Out in the collapsed header, people, thread; renamed from Riders). The "Updated …" note works as today.
- **Compact when collapsed** (2026-10-17, "Compact activity page" canvas): with every panel collapsed, a typical activity (one warning, no announcement) fits a phone without scrolling; the browser smoke test checks it at 390 × 760, an iPhone 13–16 Home Screen app between its status bar and home bar. So: the "Updated …" note is a line in the header card; the action row's tiles are 52 px; a warning is one line (title · detail); each collapsed panel is one line, at least 44 px to tap (Route: name · distance · climb, trimmed; Weather: temperature · rain · wind, with Wear and feels-like inside the panel; Who's in: the counts with In / Out on the right; Messages: the count and the latest message); 8 px between cards. An announcement banner, two or more warnings, a cancelled banner, long titles, large text sizes and small phones (iPhone SE, mini) can still scroll.
- **Action row:** every way to leave the app for something else is one row of equal tiles, in the same place and order on every activity: **Directions** (choose Apple Maps, Google Maps or Waze), **Calendar** (add this activity, or subscribe to the calendar link), **Share** (the phone's share sheet), and **RideWithGPS** for activities with a route. It replaces v1's separate "Open in Google Maps", "+ Calendar", "Open in RWGPS" links and the Share icon.
- **Buttons:** three kinds, used the same way everywhere, plus text links.
  - *Primary* (filled Light Blue): the main action, e.g. Publish, Sign in, Send, Turn on notifications; full width where it ends a form.
  - *Secondary* (white, thin border, text): other choices, e.g. Google Calendar, Copy link, Sign out. In / Out and similar either-or choices are a pair where the selected one is filled.
  - *Text links* for small or undo actions: Start over, Discard changes, Reset link, Not now, Update.
  - *Tile* (white, thin border, 64 px tall, icon over a one-word label): the action row, plus the RideWithGPS tile beside Plan's route field. RideWithGPS's tile shows only its vertical logo (`ridewithgps-vertical-logo.svg`, supplied by the team), which already carries the name; its accessible name is "Open in RideWithGPS".
  - Icon-only buttons, each with an accessible name: Edit (pencil) in the header card, the date picker's month arrows, and Call / Text on Team rows.
- **Top bar** on every screen: logo (home), **Team** (everyone), Plan and Settings (roles that have them), account. No page titles or back buttons in the bar.

### Plan
One form for every sport; choosing the sport first shapes the rest:
1. **Sport:** a three-column grid of buttons (Ride, Run, Swim, Triathlon, Pickleball, Ski, Other). Defaults to the editor's last sport.
2. **When:** date (the v1 date picker), start time (labelled **Meet time** for ride and run, **Carpool leaves** for ski, **Race start** for triathlon, **Start time** otherwise; ride starts at the team's meet time, the others at 8:00) and end. Ride and run show **Back about**, computed from route and pace as in v1; other sports have an **Ends** time, defaulting per sport (swim 1 h, triathlon 3 h, pickleball 2 h, ski 10 h, other 2 h).
3. **Title:** optional, up to 60 characters. Empty = the route's name (ride, run) or the sport's name.
4. **Where:** a saved place, or paste a Google Maps pin to add one (v1's Add a spot, now usable for pools, courts and resorts). Ride and run keep v1's spot comparison list with each spot's weather.
5. **Route** (ride and run): search the team library or paste a RideWithGPS link, with the RideWithGPS tile beside the field. Alternate route as in v1. Coffee stop: ride only.
6. **Details:** pace for ride (mph) and run (min/mi); one short **Details** line for the others (e.g. "2 courts", "Lanes 3–4", "Carpool from SUNY Purchase"), up to 80 characters.
7. **Indoor / outdoor:** swim (**Pool / Open water**), pickleball and other. Ride, run, ski and triathlon are always outdoor. Indoor turns the weather check off; everything else (notifications, calendar, who's in) works the same.
8. **Notes**, then the preview and **Publish** / **Replace** / **Update** as in v1, including autosaved drafts and edit-conflict checks.

**Several activities may share a day, of any sport** (changed 2026-10-14; v1 and early v2 allowed one per sport per day). Under the date, Plan lists "Also that day: …". Publishing a second activity of the same sport that day shows a box ("A ride is already posted for Sat, Oct 17", with its time and how many are going) and two buttons: **Publish another ride** (the main one) and **Replace Armonk ride**, which cancels that one; like any cancellation, everyone with notifications on is told (offered when exactly one is posted). Replace is always the editor's choice; the server only cancels the activity named in `replaceId`, which must be published, the same sport and day. Restoring a cancelled activity is never blocked. Home leaves out an activity cancelled by Replace (its replacement is listed) and keeps every other cancelled one, marked Cancelled.

### Weather per sport
The v1 algorithms stay; what changes is which feel and which warnings apply. Thresholds are per **weather group**, each with its own Settings panel (amber and red, as in v1):

| Group | Sports | Cold uses | Also |
|---|---|---|---|
| Ride | ride | bike feel (v1) | road wetness, low light |
| Run | run | run feel: the bike-feel formula with airflow √(run pace² + wind²), run pace in mph | low light |
| Ski | ski | wind chill from the wind alone (the same formula with no pace) | — |
| Other outdoor | triathlon, open-water swim, outdoor pickleball, outdoor other | wind chill from the wind alone | — |

Every group has the same thresholds (cold, heat, wind, gusts, rain chance and amount) plus thunder and NWS alerts; `rulesFor` in `shared/sports.ts` picks the feel, the extras and the thresholds. Ride keeps v1's thresholds. The others start with first-guess defaults (Run: cold below 30 / 15 °F, heat 82 / 90 °F, wind 18 / 25 mph, rain 50 / 80 %; Ski: cold below 5 / −10 °F; Other outdoor: cold below 45 / 35 °F), to be tuned like v1's. Settings → Weather warnings edits one group at a time. The weather window is start → end (or Back about). The kit chart stays ride-only. Recorded weather on past activities works for every outdoor activity.

### Date polls (2026-10-17, "Check dates" canvas, renamed Date poll)

Before planning, an Editor or Admin can ask which date works: Plan has two tabs, **Plan an activity** and **Date poll**.
- **A poll:** a title, an optional sport (icon, and who's notified) and note, and up to **14 options**, each a **single day** or a **block of 2–4 days** (a weekend trip), picked on a month calendar, from today up to **12 months** ahead; they needn't be next to each other (three separate weekends), but two options can't share a day. **+ Next weekend** adds the next Saturday–Sunday.
- **Who's asked:** **Everyone** (notified unless they muted its sport) or **Picked people** (only they and its creator see it, Admins included, like a private activity; all are notified).
- **Answers close** by default the day before the first option (never before today), and no later than its last day.
- **Answering:** **In / Maybe / Out** for each option, tapping again clears it, with an optional note each (140 characters; "Saturday only" on a block); **Can't make any of these** marks them all Out; one note on the whole poll. Saved as you tap; changeable until answers close.
- **Results:** everyone asked sees them. Options are ranked by In, then Maybe, then date; the best is highlighted with who's In, Maybe and Out and their notes. **N of M answered** lists who hasn't yet (the first 12, then "+N more"); its creator (while an Editor) or an Admin can **Nudge** them (one notification).
- **Plan this** (Editors and Admins, on any option, once per poll while its activity exists; deleting the activity lets it be planned again): opens Plan filled in with the title, sport, the option's first day and, for a private poll, its people. Publishing links the activity to the poll, closes it, and tells the people In or Maybe for that option ("Planned: …"); the activity shows "From the date poll …". Each side shows the other only to people who can see it (a private poll planned into a private activity for other people says just "Planned: a private activity").
- **Messages:** each poll has its own thread (the same Messages panel), for everyone asked; @mentions notify, and new messages and @here too (see Message notifications).
- **Manage:** its creator (while an Editor) or an Admin can edit the title, note and closing date (a save made from an older copy is refused: "Reload to see the latest"), close answers early, or delete it (with its answers and messages).
- **Where:** an open poll you haven't answered is a card at the top of Home (**Answer**); once answered it's a row under **Open date polls** below the list; **All date polls** (/polls) lists open ones and those closed in the last 120 days.
- **Data** (`0019_date_polls.sql`): `date_polls`, `date_poll_guests`, `date_poll_options`, `date_poll_answers`, `date_poll_notes`; `threads.poll_id` (each poll's thread, made by a trigger); `thread_seen` (when each person last read a thread, for a poll's "new" messages). The same migration drops `messages_v1`.

### Message notifications (2026-10-17, "Message notifications" canvas)
Before this, only @mentions notified. Now a thread notifies its followers too, on activities and date polls alike.
- **Followers** by default: the activity's creator, the people **In** (on a date poll: In or **Maybe** for any of its dates) and anyone who has posted in the thread; never the author. Turning a sport off (Tell me about new) doesn't stop messages on threads you follow. Private activities and polls only ever reach their people.
- **Notify me about new messages**, under each thread (while posting is open): a checkbox per person and thread (`thread_people.notify`; `PUT /api/activities/<id>/notify`, `PUT /api/polls/<id>/notify`). Off ("Off. You'll still get @mentions of you.") mutes it even while In; on follows it for anyone who can see it. @mentions reach people either way.
- **@here** (anyone who can post): offered first in the mention list from "@h" on (not when editing: edits never notify), stored as `<@here>`, shown highlighted. It notifies everyone who can see the activity or poll (a private one: its people), except the author, people who muted the thread and, among those who don't follow it, people who turned the sport off. It doesn't count toward the 10 mentions, and there's no limit on how often it's used (an invite-only team; @mentions allow the same).
- **One card per thread:** the first new message alerts ("Jo · Armonk ride" with the text; @here: "Dana to everyone · …"). Until the person opens the activity or poll, later messages replace that card quietly ("3 new messages · Armonk ride", the latest below); opening it starts over (`thread_people.alerted_at`, the alerting message's time, against `activity_seen` / `thread_seen`; it's recorded once the notification is queued, so if delivery fails the next ones still come quietly). An @here always alerts. Web Push uses the notification `tag` (quiet ones `silent`); the Android app 1.3 replaces the card by tag (`setSilent` for quiet ones); app 1.2 shows each one.
- @mentions keep their own notification (people mentioned aren't sent the thread one too). Editing never notifies. The server code is `worker/thread-notify.ts`.

### Calendar link
Each person can subscribe their own calendar (Apple, Google, Outlook) to a private feed of everything they're **In** for: upcoming activities plus the last 30 days, with changes and cancellations (shown as cancelled) updating the events by themselves. It needs no app and no calendar permission, so it works on every phone and computer.
- **Where:** the account menu (**Apple Calendar · Google Calendar · Copy link · Reset link**), the Calendar tile on an activity ("Or subscribe to your BBT calendar"), and the Welcome sheet (Android app, iPhone Home Screen app). The link is made the first time someone asks for it. The one-off **Add this activity** (.ics, Google, Outlook links) stays.
- **How:** `GET /api/cal/<user>.<version>.<signature>.ics`, where the signature is HMAC-SHA256 of the user and version with the Worker's `SESSION_SECRET` (`worker/routes/calendar.ts`). The signature is checked before any database read. Rotating `SESSION_SECRET` (which also signs everyone out) ends every calendar link; people get a new one from the account menu. Only the version is stored (`calendar_links`): **Get my calendar link** makes it (asking again returns the same link), **Reset link** bumps it and the old link returns 404, as does a forged link. Disabling someone also bumps it, so re-enabling them doesn't revive the old link. This is the one data URL that works without a session, so the feed carries only that person's own activities (the newest 100) and no messages or names of who else is in. Calendar apps poll it, so it never calls RideWithGPS: the end time uses cached routes only, and route links are built from the id. The feed's UID is the activity id; a one-off event from the Calendar tile gets a different UID (`<id>-once`), because a subscribed calendar is a separate calendar and some apps refuse a UID they already hold. `SEQUENCE` / `LAST-MODIFIED` follow the activity's last update; changes elsewhere (a place's name, a team setting that moves the end time) show up when the app re-reads the feed, which subscribed calendars do in full each time.
- **Refresh:** each calendar app polls on its own schedule; Apple Calendar typically within hours, Google Calendar can take up to a day. Notifications stay the fast path for last-minute changes.

### Notifications
- **What:** v1's updated / cancelled / restored, plus **New activity posted**, **mentions** (see Mentions), **new messages** and **@here** (see Message notifications) and **Deleted** (to the people going; see Deleting an activity). A private activity notifies only the people invited (see Private activities). What a notification shows: the activity's name, day, time and place, what changed, for a mention who wrote and the message, and for a new message or @here who wrote, the activity's or poll's name and the message (or "3 new messages").
- **Who:** changes, cancellations and restores go to everyone with notifications on, as in v1. A new activity goes to everyone but its author who hasn't turned that sport off: the account menu has **Tell me about new** with one toggle per offered sport plus Other (all on by default; the exceptions are stored per person in `notify_off`, not per device; each toggle saves on its own, `PUT /api/me/muted/<sport>`).
- **Buttons:** a change to an activity someone is In for carries **Still in** / **I'm out**. They work in the Android app and in Chrome on Android and desktop; on iPhone the notification opens the activity instead. **I'm out** answers from the service worker (`PUT /api/activities/<id>/rsvp`) and confirms with a "You're out" notification; if that fails or takes over 5 seconds (signed out, offline) it opens the activity. **Still in** just closes the notification.
- **Delivery:** the v1 Queue, unchanged in shape. Each device is either a Web Push subscription (browsers, iPhone Home Screen app) or a Firebase Cloud Messaging token (Android app). FCM is free; the Worker signs a Google OAuth token from a service-account key (Worker secret `FCM_SERVICE_ACCOUNT`) and caches it in KV for 55 minutes, so each queue run still does one cheap signature at most.

### Android app
- **Built with Capacitor 8** around the same web app, in `android/` in this repo (`capacitor.config.ts`, app id `team.bbt.app`). The app opens `https://app.bbt.team` in its WebView (Capacitor's `server.url`), so every web deploy reaches Android users at once and the APK only changes when the native shell does. When app.bbt.team can't be loaded it shows `native/www/offline.html` ("Couldn't reach BBT", Retry). Edge to edge: the page pads itself with `env(safe-area-inset-top/bottom)` (body, main, sheets), the top bar's blue continues under the status bar with light icons, and the navigation bar follows the phone's theme. Back closes an open sheet first, then goes back a page. A tapped notification may only open home, `/a/<id>`, `/polls/<id>` or `/announcements` (version 1.2, 2026-10-17; 1.1 opened home for the last two).
- **One small plugin instead of several:** `BbtNativePlugin.java` gives the web app (`src/lib/native.ts`) the app version, the Firebase token and notification permission, Google sign-in, the share sheet and opening links outside (the APK download). Links to other sites (Maps, Waze, Google Calendar, RideWithGPS) leave the WebView by themselves and open the matching app. The WebView can't download files, so the app hides the .ics choices and Apple Calendar; Google Calendar and the calendar link remain.
- **Notifications:** the Worker sends data-only Firebase messages and the app draws every notification itself (`BbtMessagingService`, `Notifier`): the bike logo, tap to open the activity, and Still in / I'm out. **I'm out** is answered by `RsvpReceiver` with the WebView's session cookie and an `Origin` header, then shows "You're out" (or "Couldn't answer · tap to open"). The web app registers the device's current token each time it starts, once a phone number is saved (`POST /api/push/app`); a person keeps their newest 10 devices; a password reset removes them all. The Worker forgets a token only on Firebase's `UNREGISTERED` or `SENDER_ID_MISMATCH`.
- **Sign-in:** Google blocks its sign-in page inside app WebViews, so the app uses Android's Credential Manager (Sign in with Google) to get an ID token for the web OAuth client and hands it to Better Auth (`signIn.social` with `idToken`), which checks it and applies the same invite rule. Google allows it through an Android OAuth client with the app's package and signing SHA-1 (SETUP.md → 7). Username/email + password works as on the web.
- **First launch:** a Welcome sheet with Turn on notifications and the calendar link, after the one-time phone screen; shown once per install. No location.
- **Distribution:** a signed APK, built in the Deploy workflow (`scripts/build-apk.sh`, no Mac needed) and served with the site at `/download/bbt.apk`, with the public page `/download/`, "BBT on your phone" (the APK contains no team data; sign-in stays invite-only). People allow "install unknown apps" once. No Google Play account; Play ($25 once) stays an option. The deploy writes `/download/android.json` (`versionCode`, `versionName` from `android/app/build.gradle`); the app compares it with its own and shows "Update available", which opens the download page in the browser. The APK builds in its own job, away from the Cloudflare token (Gradle wrapper validated); if it fails the run shows red, and the web app still deploys without the APK. Phone browsers get **Install on Android** or **Install on iPhone** in the account menu. CI also compiles an unsigned release build on every branch.
- **Secrets:** the APK signing key and the Firebase config (`google-services.json`) live in GitHub repository secrets; `FCM_SERVICE_ACCOUNT` is a Worker secret (SETUP.md → 7).

### iPhone
- **Equal footing with Android:** the home page has two equal buttons, **Get it on iPhone** and **Get it on Android**. The download page, "BBT on your phone", has two matching cards (three steps each, a button, a short note) and puts the visitor's own phone first, highlighted. The account menu offers **Install on iPhone** in Safari as it offers **Install on Android** in Android browsers. Same word, "install", for both. The only difference left is that iPhone notifications have no Still in / I'm out buttons; the pages don't mention notification buttons.
- For now: the Home Screen web app with Web Push (iOS 16.4+), plus the calendar link. Native notification buttons and an App Store install are what's missing.
- **Install hint:** in an iPhone or iPad browser tab, signed-in members see a card above the page: "Get notifications: add BBT to your Home Screen", with the three taps (Share, Add to Home Screen, open it and sign in once more; the Home Screen app keeps its own sign-in). **Not now** hides it for 30 days (`src/components/InstallHint.tsx`).
- **First open from the Home Screen:** the same Welcome sheet as the Android app (Turn on notifications, the calendar link with Apple Calendar), once, skipped if notifications are already on.
- **Look:** drawn under the status bar (`black-translucent`), so the top bar's blue fills it with white status icons, as in the Android app. The Home Screen icon is the bike logo.
- Later: the same Capacitor project gains `ios/`, push via FCM (which also delivers to Apple's service), distributed by an unlisted App Store link. Needs the Apple Developer Program ($99/year) or Apple's nonprofit fee waiver, which the team is looking into.

### Data model changes
Step 1 (`0007_activities.sql`, built):
```
rides → activities: + sport CHECK(sport IN ('ride','run','swim','pickleball','ski','other')) DEFAULT 'ride',
                    + title DEFAULT '', + end_time NULL, + outdoor DEFAULT 1, + details DEFAULT '',
                    meet_time → start_time; pace_mph stays NOT NULL, 0 for sports without a pace
                    -- UNIQUE(date, sport) WHERE status = 'published' (dropped in 0012: several per day)
ride_routes → activity_routes; ride_id → activity_id in activity_routes, rsvps, messages
spots: note optional (pools and courts may need none)
settings: + 'sports' (the enabled list); the twelve threshold keys become one 'warn' key: { ride, run, ski, outdoor }
activities: + icon NULL  -- 0010 (2026-10-14): an Other activity's picked icon (shared/sport-icons.ts)
activities.sport, notify_off.sport: CHECK dropped -- 0011 (2026-10-14, Triathlon): the API validates sports, so a new
                    sport needs no migration; activities kept its rows (column swap, never a table rebuild)
```
Later (2026-10-14):
```
0012_same_day_and_seen.sql: activities_date_sport(date, sport) index instead of the unique one (several per day);
  activity_seen(user_id, activity_id, seen_at, PRIMARY KEY(user_id, activity_id))  -- last visit; goes with user or activity
  seen_baseline(user_id PRIMARY KEY, at)                                           -- when markers started for the person
0013_contacts.sql: user + phone NULL, + emergency_name NULL, + emergency_phone NULL  -- "+" and digits; the app requires a phone
```
Later (2026-10-15):
```
0014_private.sql: activities + private DEFAULT 0;
  activity_guests(activity_id, user_id, PRIMARY KEY(activity_id, user_id))  -- a private activity's people; goes with either
0015_announcements.sql: announcements(id, title, body, ends_on NULL, ended_at NULL, created_by, created_at, updated_at);
  announcement_seen(announcement_id, user_id, at, PRIMARY KEY(announcement_id, user_id))  -- Got it; goes with either
0016_online_places.sql: spots + online DEFAULT 0  -- an online place keeps its meeting link in maps_url, lat/lng 0
0017_poster_sees_announcement.sql: drops the "seen" rows once added for an announcement's poster at posting time
```
Later (2026-10-17, Messages as their own panel; threads for date polls next):
```
0018_threads.sql: threads(id, kind, activity_id UNIQUE NULL → activities CASCADE, created_at)  -- one per owner
  messages(id, thread_id → threads CASCADE, user_id NULL, parent_id NULL, kind DEFAULT 'user', body, created_at,
           edited_at NULL, deleted_at NULL)  -- replaces the activity-keyed table, renamed messages_v1 until dropped
  -- Each owner kind gets its own nullable column on threads (date polls: poll_id), so deleting the owner deletes its
  -- thread and messages; `kind` is checked by the app, so a new kind needs no table rebuild (worker/threads.ts).
  -- A trigger (activity_thread) makes an activity's thread when the activity is inserted.
```
Step 2 (`0008_notify_calendar.sql`, built):
```
notify_off(user_id, sport, PRIMARY KEY(user_id, sport))          -- sports a person muted for new posts
calendar_links(user_id PRIMARY KEY, version, created_at)        -- the link is signed, nothing secret is stored
```
Step 3 (`0009_app_push.sql`, built):
```
push_subscriptions: + kind CHECK(kind IN ('web','fcm')) DEFAULT 'web'; for fcm, endpoint = the Firebase token, keys_json '{}'
```
Existing rides become `sport = 'ride'`, outdoor, with empty titles. Ride thresholds an Admin changed carry over into `warn.ride`; drafts are cleared. The server checks each sport's fields (`activityInput` in `shared/api.ts`: a route and a pace for ride and run, an end time after the start for the rest; fields that don't apply are stored empty) and refuses a new activity for a sport that's turned off. The API moves to `/api/activities`, pages to `/a/<id>` (upcoming and past alike; a past one is read-only with Reuse this plan). Old `/ride/<date>` and `/past/<id>` links aren't kept: nobody but the captain used them. Home lists a cancelled activity, except one cancelled by Replace (see "Several activities may share a day"). The header card's first line is the sport, plus Pool / Open water or Indoor / Outdoor for sports that can be either.

### Build order
Each step is its own PR, deployed before the next:
1. **Any sport on the web** (built): migration, Plan, home list, activity page with the action row, Settings → Sports and the weather groups, places with optional notes, the rename to BBT, the RideWithGPS tile.
2. **Calendar link and per-sport notifications** (built), including New activity posted and Still in / I'm out.
3. **Android app** (built): Capacitor shell, FCM delivery, native Google sign-in, signed APK and its download page.
4. **iPhone app:** when the Apple fee is settled.

After step 3 (2026-10-14 and 15, one PR each): tester quick wins and Triathlon; History; several per day and New and unread; Team and contacts, mentions and deleting activities; Garmin help and game icons; private activities; announcements; virtual meet-ups.

## Public site (www.bbt.team)
- A one-page home for the team at **www.bbt.team** (and `bbt.team`), design B on the private "bbt.team Home Page" canvas. It points members to the app and asks nothing of visitors: the team is invitation-only, so there's no sign-up, request-access form or contact address on it.
- Content: top bar with **Open BBT**; headline "Rides, runs, swims and more, planned together."; **Open BBT**, then **Get it on iPhone** and **Get it on Android** as two equal buttons (to the matching card on `app.bbt.team/download/`); the sports; How it works (see what's planned, say you're in, never miss a change); footer links to the app, phone apps and Privacy. Light and dark like the app; system fonts.
- Built as plain HTML in `www/public/` and deployed as its own Worker `bbt-www` with static files only (`www/wrangler.jsonc`), so it can't affect the app. No scripts, cookies or third-party requests; its CSP allows only its own images and inline styles. Domains attached by hand (SETUP.md → 8).

## Backlog (post-v1)
1. **Route weather** — forecast at points along the route by ETA; head/tail/crosswind per segment.
2. **WhatsApp integration** (or another messenger) — post the ride brief to the group chat.
3. **Model comparison** — HRRR vs NBM vs ECMWF agreement as a confidence hint.
4. **Leave-by alerts** — "Leave by 8:25" from the phone's location and current traffic (native apps only; needs a traffic API such as Google Routes).
5. **Spots limit with a waitlist** — optional cap per activity (courts, lanes); the first person on the waitlist moves in when someone drops out.

## Seed data
`data/seed.json` (built 2026-10-08 from public sources; raw responses in `data/raw/`):
- Spots: SUNY Purchase, Armonk, Reeves (coordinates resolved from the Google Maps links).
- Routes: 57426135, 57406828, 57215407, 37475253 with stats, simplified track (lat, lng, elev m, dist m), POIs with distance along route, and nearest spot (all start within 160 m of a spot).
- 36 route IDs linked from the public RWGPS group page `groups/BBT`.
- Default pace 17 mph.

Verified 2026-10-08: public route JSON (`/routes/{id}.json`) needs no key; listing a user's routes (`/users/{id}/routes.json`) returns 403 without auth; Open-Meteo `best_match`, `gfs_hrrr`, `ncep_nbm_conus`, `minutely_15`, `past_days` all work for these spots; NWS points API works (grid OKX).

## Decisions
See `DECISIONS.md`.
