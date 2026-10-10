# BBT Ride Weather — Design

Status: **in design** — clickable prototype at `prototype/index.html`. Last updated 2026-10-09.
URL: **ride.bbt.team**

## Purpose
Help the BBT captain plan weekend rides and the team show up prepared:
1. **Are the roads dry?** — look back at recent rain at each spot.
2. **What will the ride feel like?** — temp, real feel, bike feel, wind, rain across the ride window.
3. **What should we wear?**
4. **Where/when/which route?** — the published ride with RWGPS route details and parking pin.

## Users and roles
Sign-in is required. Users sign in with Google (OpenID Connect, handled by the Worker). Access is invite-only: the `users` table is the allowlist.

| Role | Can do |
|------|--------|
| **View** (default) | View rides, weekend board, spot detail, forecasts |
| **Edit** | View + create, edit, publish and archive rides; manage spots |
| **Admin** | Edit + change team settings (thresholds, defaults, kit chart) and manage users |

- An Admin invites a user by email and picks a role (View by default). The invite is a row in `users` with status `invited`.
- On first Google sign-in, the Worker matches the verified Google email (`email_verified = true`) to an invited row, stores the Google `sub`, and marks it `active`. Later sign-ins match on `sub`, so an email change at Google doesn't lock anyone out.
- A Google account not in `users` gets a "Not invited — ask a team admin" page. No row is created.
- Sessions: an opaque random session ID in an `HttpOnly; Secure; SameSite=Lax` cookie, stored in D1 `sessions` (30-day sliding expiry). Role is re-read from `users` on each request, so a role change or removal takes effect immediately.
- Every API route checks the role server-side; the UI only hides what the role can't do.
- Bootstrap: the first Admin's email comes from the `BOOTSTRAP_ADMIN_EMAIL` Worker variable and is inserted as an active Admin by the first migration run.
- Audit: `audit_log` records who changed rides, settings and users, and when.

### Data model (D1)
```
users(id, email UNIQUE, google_sub UNIQUE NULL, name, role CHECK(role IN ('view','edit','admin')) DEFAULT 'view',
      status CHECK(status IN ('invited','active','disabled')), invited_by, created_at, last_login_at)
sessions(id PRIMARY KEY, user_id, created_at, expires_at, user_agent)
settings(key PRIMARY KEY, value_json, updated_by, updated_at)        -- one row per setting
kit_bands(id, min_feel_f, name, items_json, sort)                    -- editable kit chart
spots(id, name, lat, lng, maps_url, note, archived)
rides(id, date, rollout, spot_id, pace_mph, stop_min, notes, status CHECK(status IN ('draft','published','archived')), created_by, updated_by, updated_at)
ride_routes(ride_id, sort, label, rwgps_route_id, stop_poi_json)
route_cache(rwgps_route_id PRIMARY KEY, json, fetched_at)
rsvps(ride_id, user_id, status CHECK(status IN ('in','out')), route_label NULL, updated_at, PRIMARY KEY(ride_id, user_id))
messages(id, ride_id, user_id, parent_id NULL, body, created_at, edited_at NULL, deleted_at NULL)  -- parent_id = reply to
audit_log(id, user_id, action, entity, entity_id, diff_json, at)
```

## v1 scope

### Rides (viewer home)
- Editor plans a ride on **any date** (weekend or weekday): date, roll-out time, start spot, avg pace, notes, and one or more routes. Draft → Publish.
  - Usually one route; occasionally a labeled alternate (e.g., "Full" / "Short") sharing the same spot and time.
- Home shows upcoming published rides as date tabs: this Saturday and Sunday always, plus any other day that has a published ride. The tab carries the date; the page doesn't repeat it.
- Ride page = warnings (only when something needs attention) + a stack of collapsible panels. Each collapsed header is the briefing; tapping it expands detail. Open/closed state is remembered per rider; panels start open on desktop.
  - **Meet** — collapsed: roll-out time · spot name (links to Google Maps). Expanded: estimated time back (moving + regroup buffer + coffee stop, and the time without the stop), parking notes, Open in Google Maps, and "+ Calendar", which opens a picker: Google Calendar, Apple Calendar (.ics), Outlook.com, Outlook (work or school), Other (.ics). The .ics is served by `/api/rides/:id.ics`; event = meet → back, location = parking pin, routes and notes in the description).
  - **Route** — collapsed: route name (opens RWGPS) · distance · climbing, plus the Full/Short switcher. Expanded: map, elevation profile, coffee stop (name links to Maps, mile, ETA, length, weather there; labeled optional), "Open in RWGPS".
  - **Weather** — collapsed: temp range · real feel range · wind · rain chance, a warning count if any, and a one-line kit hint. Expanded: ride-window summary (bike feel, gusts, rain total, roads), hourly table from 1 h before roll-out to 3 h after the estimated return (ride window shaded; Sky column uses icons for clear, partly cloudy, overcast, fog, drizzle, rain, showers, snow and thunder, with a moon for clear night hours and the label on hover and for screen readers), a "Full-day forecast" button that opens the rider's chosen weather source (NWS, Weather.com, Windy or Google; choice saved in their browser), then What to wear (Run cold / Avg / Run hot).
  - **Notes** — only if the ride has notes; collapsed shows the first line.
  - **Riders** — collapsed: "5 in · 1 out · 3 messages" plus **In / Out** buttons, so riders answer without opening the panel; the Full / Short choice appears only when the ride has an alternate route and only after tapping In; Out never asks for a route. Expanded: who's in (with their route) and out, and a message thread for the ride: anyone can post, reply to a message (one level), and see everyone's messages. All signed-in roles can RSVP and post. Authors can edit or delete their own messages; Edit and Admin can delete any (moderation). The page refreshes RSVPs and messages every 30 s while open.
  - **Share** icon next to the day tabs: uses the phone's share sheet (Web Share API) with a text brief (date, meet time and Maps link, routes with RWGPS links, coffee stop, time back, weather, notes) plus the ride link; falls back to a copy-to-clipboard sheet. The ride link requires sign-in.
  - Warnings: wet/drying roads, cold, heat, wind, rain, thunder, and low light (roll-out within 30 min of sunrise). No Go badge.
- Route picker: search RWGPS routes from the captain's personal library **and** the BBT club library, or paste a RWGPS link. Suggest start spot by nearest saved spot to route start.
  - "Open in RWGPS" works for viewers only if the route is public or shared; map/stats render regardless.
- **Coffee / muffin stop (optional)** — a ride can have an optional mid-ride stop.
  - Auto-suggested from the route's RWGPS POIs (`poi_type_name` = `coffee` or `food`); editor confirms, picks another POI, or adds one manually (name + Google Maps link).
  - Ride page shows: name, mile marker, ETA (roll-out + distance ÷ pace), stop length (default 20 min, shifts the rest of the ride window), weather at the stop, "Open in Maps", and an "optional" label.
- **Archive** — past rides list (date, route(s), spot, recorded conditions at roll-out); "reuse this plan".

### Spots
- Fields: name, location (lat/lng), Google Maps link, parking notes (where to park, restrooms).
- **Add (Edit and Admin):** "Add a start spot" at the bottom of Plan's spot list. Enter a name, paste a Google Maps link (drop a pin on the parking spot → Share → Copy link) or plain coordinates, and parking notes; Save selects the new spot.
  - Full Maps links are parsed in the browser (`@lat,lng` or `?q=lat,lng`). Short `maps.app.goo.gl` links are resolved by the Worker (follow the redirect, then parse), since browsers can't read cross-site redirects.
  - The Worker fetches the forecast for the new point on save.
- **Manage (Admin):** a Spots panel in Settings to rename, edit notes, move the pin, or archive. Archived spots drop out of the pick list but stay on past rides.

### What to wear
- Default team kit chart keyed on **bike feel** + wind + rain + road wetness; editors can tune.
- Per-rider offset (runs cold / avg / hot, ±5°) stored in that rider's browser.
- Shedding hints when temp rises during the ride; fenders when roads damp.

### Settings (Admin only, stored in D1)
Every setting lives in the `settings` table and is edited on the Settings tab; nothing is hard-coded except first-run defaults. Collapsible panels, each with a one-line summary of the current values:
- **Users:** invite by email with a role, change roles, disable.
- **Ride defaults:** roll-out **8:30**, weather window 3 h (used before a route is picked), pace 17 mph, coffee stop **20 min** (typical 15–20), regroup buffer **5 %** of moving time.
- **Road wetness:** look-back hours, Wet / Drying film thresholds.
- **Warnings:** amber and red thresholds for cold (bike feel), heat (real feel), wind, gusts, rain chance, rain amount.
- **Kit chart:** bands and items (`kit_bands`).
- Units: °F/mph for v1.

Per-rider preferences stay in the rider's browser: theme (header toggle), Run cold / Avg / Run hot, weather source, which panels are open.

### Plan a ride (Edit and Admin)
Planning is one top-to-bottom flow in the same panel style, mirroring the ride page. There is no separate Weekend page; navigation is Ride / Plan / Settings (View riders see Ride only).
1. **Meet:** Sat / Sun tabs or any date, and roll-out time.
2. **Start spot:** a compact pick list, one row per spot: name, temp · real feel · wind · rain for the weather window, and warning chips only when something needs attention. Tap a row to select it. The selected spot gets a collapsed **Details** panel below: bike feel, gusts, rain and road state; rain bars −12 h → +8 h; hourly table (1 h before → 3 h after); Full-day forecast and Radar; parking notes and Google Maps. The weather window is the default length (Settings) until a route is picked, then the route's actual ride time. The last row is **Add a start spot** (see Spots).
3. **Route:** routes that start at the chosen spot are listed first ("starts here"), plus search or a pasted RWGPS link; a note appears if the route starts away from the spot. Optional alternate route with labels, coffee stop from the route's POIs, pace. Picking a route first (before a spot) selects its nearest spot.
4. **Notes.**
5. **Preview:** the actual ride-page warnings and panels for the draft, then Publish / Save draft.

### Metrics
- **Real feel** — standard apparent temperature.
- **Bike feel** — wind chill using rider speed + wind (pace configurable).

### Platform
- Mobile-first, installable PWA; desktop uses multi-column layout of the same views.

## Brand
Source files in `brand/` (color sheet, logo .ai/.svg/.pdf, favicon). Web-ready versions in `brand/web/`:
- `bbt-logo.svg` — full bike logo, used in the top bar (5 KB; source SVG was 948 KB due to an embedded ICC profile).
- `bbt-wordmark.svg` — "bbt" wordmark for favicon/app icons (1 KB).
Both use `fill="currentColor"` so they can switch between navy, white, and orange.

| Name | sRGB | Use |
|------|------|-----|
| BBT Light Blue | `#0077D1` | Top bar; primary buttons (white text, 4.6:1 AA); links on light. Links/outline buttons lightened to `#4DA3FF` on dark |
| BBT Orange | `#FF3115` | Accent only: stripe under top bar, active tab underline. Not used for buttons |
| BBT Dark Blue | `#020C2B` | Dark-mode page background |
| Logo navy | `#03144D` | Primary text on light; dark-mode cards |

Navy roles confirmed 2026-10-09: `#020C2B` background, `#03144D` text/cards; `#1C367B` is not used.
| BBT Transition Blue | `#041DB2` | Secondary accent (charts, selected states) |

- **Top bar:** white bike logo (`bbt-logo.svg`, ~32px tall) on Light Blue, with a 4px orange stripe directly underneath (no separator). Same bar in light and dark mode. Orange and light blue are nearly equal in brightness (1.25:1); if the edge shimmers on real phones, fall back to a 2px white hairline between them.

- Go / Caution / No-go use separate green / amber / red tinted pills (with icon + label) so No-go never reads as brand orange.
- Light and dark mode both supported; dark mode is navy-based, not gray.
- PWA icons (180/192/512) generated from the wordmark at build time.

## Algorithms
All inputs are Open-Meteo hourly values in °F, mph, inches, local time (America/New_York). `precipitation` at hour *h* is the total for the hour ending at *h*. Values between hours are linearly interpolated (wind direction and weather code use the nearest hour). Reference implementation: `prototype/src/app.html` (`roadAt`, `bikeFeel`, `evaluate`, `kitAdvice`, `rideTimes`).

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

Also shown: rain total in the look-back window and hours since the last measurable rain (≥ 0.005"). The warning uses the state at roll-out; the ride page also notes if the state changes by the finish. Coefficients are a first guess to be tuned against real Saturdays (see QUESTIONS.md).

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
Evaluated on 15-minute samples across the ride window. Each factor gets a level: none, amber (caution) or red (no-go). Only factors with a level are shown, as warnings on the ride page and chips on the Plan page's spot panels; there is no overall Go badge. Defaults (editable in Settings):

| Factor | Measure | Amber | Red |
|---|---|---|---|
| Road | state at roll-out | Drying | Wet |
| Cold | min bike feel | < 40 °F | < 32 °F |
| Heat | max real feel | ≥ 92 °F | ≥ 100 °F |
| Wind | max sustained / max gust | ≥ 15 / ≥ 25 mph | ≥ 22 / ≥ 35 mph |
| Rain | max chance / total in window | ≥ 30 % / ≥ 0.01" | ≥ 60 % / ≥ 0.05" |
| Thunder | weather code 95–99 in window | — | any |

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
- **Packable rain jacket** — max rain chance ≥ 30 % or ≥ 0.01" expected in the window.
- **Clip-on fenders + shoe covers** — road Drying or Wet at roll-out.
- **Wind vest** — sustained wind ≥ 12 mph and the band doesn't already include one.
- **Shedding hint** — bike feel rises ≥ 8° and crosses a band: dress for the start band, pack layers to shed to the finish band.

### ETA math
```
moving time      = distance ÷ pace                         (46.2 mi ÷ 17 mph = 2 h 43 m)
k                = 1 + regroup buffer (default 5 % → 1.05)
ETA at mile m    = roll-out + (m ÷ pace) × k               (Tazza, mile 24.4 → 8:30 + 1 h 30 m = 10:00)
after the stop   = + stop length (default 20 min)
ride window      = roll-out → roll-out + moving time × k + stop (8:30 → 11:41)
```
Mile markers come from the POI's distance along the RWGPS track (nearest track point). The regroup buffer is an Admin setting; 0 % gives pure moving time. Weather at the stop is the forecast at the POI's coordinates at its ETA.

## Prototype
`prototype/index.html` — one self-contained file (inline CSS/JS, Leaflet 1.9.4 from cdnjs). Built from `prototype/src/app.html` by `python3 prototype/build.py`, which inlines `data/seed.json`, the fallback forecast `data/raw/om_purchase.json`, and the logo.
- Fetches Open-Meteo live in the browser for the 3 spots + coffee-stop POIs (one multi-location request, `past_days=2`). On failure it uses the embedded sample and shows a banner.
- Screens: Ride (date tabs, Meet / Route / Weather / Notes panels, share, calendar), Plan a ride (mock; spot comparison → route → preview that reuses the ride panels), Settings (panels; stored in this browser). A View / Edit / Admin switcher demonstrates roles.
- Without Leaflet (offline/CDN blocked) maps fall back to an SVG route outline.

## Data sources
- **Forecast:** Open-Meteo (free, no key) — HRRR (3 km, 15-min) + NBM for US; past hours for road-dryness.
- **Observed:** nearest NWS station observations; RainViewer radar tiles.
- **Routes:** RideWithGPS API v1 (API key + secret + auth token, stored as Worker secrets; see Secrets). To verify at build time: listing club/organization routes via the API; paste-link fallback always works.

## Secrets
Never in the repo, the built assets, or any response to the browser. All third-party calls that need a credential go through the Worker.

| Secret | Where it lives | Used by |
|---|---|---|
| `RWGPS_API_KEY`, `RWGPS_API_SECRET`, `RWGPS_AUTH_TOKEN` | Cloudflare Worker secrets (`wrangler secret put …`) | Worker → RideWithGPS |
| `GOOGLE_CLIENT_ID` (not secret), `GOOGLE_CLIENT_SECRET` | Worker variable / Worker secret | Google sign-in |
| `SESSION_SECRET` (random 32 bytes) | Worker secret | Signing OAuth `state` / CSRF tokens |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Claude Code cloud environment secret (and your own machine for manual deploys) | `wrangler deploy`, D1 migrations |

- Local development: `.dev.vars` (git-ignored) with the same names; a committed `.dev.vars.example` lists the names with empty values.
- Worker secrets are write-only: once set, Cloudflare never shows them again; rotate by running `wrangler secret put` with the new value.
- The browser calls `/api/routes/:id` and `/api/routes/search`; the Worker adds the RWGPS credentials and caches results in D1 `route_cache`.

## Architecture
- Cloudflare Worker + static assets (React + TypeScript + Vite) on ride.bbt.team.
- D1: spots, rides, route cache, settings, kit chart. KV: forecast cache.
- Every route requires a session (Google sign-in); API routes enforce View / Edit / Admin server-side.

## Backlog (post-v1)
1. **RWGPS route weather** (phase 2) — forecast at each point by ETA; head/tail/crosswind per segment.
2. **Shareable ride brief** — public link + copyable text.
3. **WhatsApp integration** (or other messenger) — post ride brief to group chat.
4. **Morning-of push alert** — PWA push N hours before ride; also optional pushes for new messages and replies to you.
5. **Model comparison** — HRRR vs NBM vs ECMWF agreement/confidence.

## Seed data
`data/seed.json` (built 2026-10-08 from public sources; raw responses in `data/raw/`):
- Spots: SUNY Purchase, Armonk, Reeves (coordinates resolved from the Google Maps links).
- Routes: 57426135, 57406828, 57215407, 37475253 with stats, simplified track (lat, lng, elev m, dist m), POIs with distance along route, and nearest spot (all start within 160 m of a spot).
- 36 route IDs linked from the public RWGPS group page `groups/BBT`.
- Default pace 17 mph.

Verified 2026-10-08: public route JSON (`/routes/{id}.json`) needs no key; listing a user's routes (`/users/{id}/routes.json`) returns 403 without auth; Open-Meteo `best_match`, `gfs_hrrr`, `ncep_nbm_conus`, `minutely_15`, `past_days` all work for these spots; NWS points API works (grid OKX).

## Open questions
See `QUESTIONS.md`.
