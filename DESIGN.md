# BBT Ride Weather — Design

Status: **in design** — clickable prototype at `prototype/index.html`. Last updated 2026-10-09.
URL: **ride.bbt.team**

## Purpose
Help the BBT captain plan weekend rides and the team show up prepared:
1. **Are the roads dry?** — look back at recent rain at each spot.
2. **What will the ride feel like?** — temp, real feel, bike feel, wind, rain across the ride window.
3. **What should we wear?**
4. **Where/when/which route?** — the published ride with RWGPS route details and parking pin.

## Roles
| Role | Can do | Auth |
|------|--------|------|
| Owner | Everything, manage editors | Cloudflare Access |
| Editor | Manage spots, rides, settings, kit chart | Cloudflare Access (email allowlist; Google or one-time PIN) |
| Viewer | Read-only, no login | none |

## v1 scope

### Rides (viewer home)
- Editor plans a ride: date, roll-out time, start spot, avg pace, notes, and one or more routes. Draft → Publish.
  - Usually one route; occasionally a labeled alternate (e.g., "Full" / "Short") sharing the same spot and time.
- Viewer home shows upcoming published rides (e.g., Sat / Sun tabs). Each ride page:
  - Route card from RWGPS (switcher when there are alternates): name, map preview, distance, elevation gain, est. moving time (distance ÷ pace), elevation profile, "Open in RWGPS".
  - Parking: spot name, notes, "Open in Google Maps" pin link.
  - Conditions at start for the ride window: road status, temp, real feel + bike feel, wind/gusts/direction, rain.
  - What to wear (with per-rider cold/avg/hot offset).
  - Captain's notes.
- Route picker: search RWGPS routes from the captain's personal library **and** the BBT club library, or paste a RWGPS link. Suggest start spot by nearest saved spot to route start.
  - "Open in RWGPS" works for viewers only if the route is public or shared; map/stats render regardless.
- **Coffee / muffin stop (optional)** — a ride can have an optional mid-ride stop.
  - Auto-suggested from the route's RWGPS POIs (`poi_type_name` = `coffee` or `food`); editor confirms, picks another POI, or adds one manually (name + Google Maps link).
  - Ride page shows: name, mile marker, ETA (roll-out + distance ÷ pace), stop length (default 20 min, shifts the rest of the ride window), weather at the stop, "Open in Maps", and an "optional" label.
- **Archive** — past rides list (date, route(s), spot, recorded conditions at roll-out); "reuse this plan".

### Spots
- Name, Google Maps parking pin link (coordinates parsed from link; short links resolved server-side), notes (parking, restrooms).
- Add via Maps link, search, map tap, or current location. One-off spots allowed.

### Weekend board (editor planning view; also visible to viewers)
- Card per spot for selected day + start time + duration: road status (Dry / Drying / Wet), temp range, real feel / bike feel, wind + gusts + direction, rain chance/amount, Go / Caution / No-go verdict (worst factor wins).

### Spot detail
- Rain bars −12h → +8h with ride window highlighted, hourly (15-min where available) table, radar loop.

### What to wear
- Default team kit chart keyed on **bike feel** + wind + rain + road wetness; editors can tune.
- Per-rider offset (runs cold / avg / hot, ±5°) stored in that rider's browser.
- Shedding hints when temp rises during the ride; fenders when roads damp.

### Settings
- Units (°F/mph default), thresholds (min feel, max wind/gust, rain cutoff, look-back hours), default roll-out time/duration/pace, kit chart.

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
| State | Rule | Verdict level |
|---|---|---|
| **Wet** | rain ≥ 0.01" in the current hour, or `W ≥ 0.5 mm` | No-go |
| **Drying** | `0.1 ≤ W < 0.5 mm` | Caution |
| **Dry** | `W < 0.1 mm` | Go |

Also shown: rain total in the look-back window and hours since the last measurable rain (≥ 0.005"). The verdict uses the state at roll-out; the ride page also notes if the state changes by the finish. Coefficients are a first guess to be tuned against real Saturdays (see QUESTIONS.md).

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

### Verdict (Go / Caution / No-go)
Evaluated on 15-minute samples across the ride window. Each factor gets a level; **the worst factor wins**. Defaults (editable in Settings):

| Factor | Measure | Caution | No-go |
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
ETA at mile m    = roll-out + m ÷ pace                     (Tazza, mile 24.4 → 8:00 + 1 h 26 m = 9:26)
after the stop   = + stop length (default 20 min)
ride window      = roll-out → roll-out + moving time + stop (8:00 → 11:03)
```
Mile markers come from the POI's distance along the RWGPS track (nearest track point). No allowance for regroups or lights in v1 (see QUESTIONS.md). Weather at the stop is the forecast at the POI's coordinates at its ETA.

## Prototype
`prototype/index.html` — one self-contained file (inline CSS/JS, Leaflet 1.9.4 from cdnjs). Built from `prototype/src/app.html` by `python3 prototype/build.py`, which inlines `data/seed.json`, the fallback forecast `data/raw/om_purchase.json`, and the logo.
- Fetches Open-Meteo live in the browser for the 3 spots + coffee-stop POIs (one multi-location request, `past_days=2`). On failure it uses the embedded sample and shows a banner.
- Screens: Ride (Sat/Sun, Full/Short), Weekend board, Spot detail (rain −12 h → +8 h, hourly, RainViewer radar), Plan a ride (mock), Settings (stored in this browser).
- Without Leaflet (offline/CDN blocked) maps fall back to an SVG route outline.

## Data sources
- **Forecast:** Open-Meteo (free, no key) — HRRR (3 km, 15-min) + NBM for US; past hours for road-dryness.
- **Observed:** nearest NWS station observations; RainViewer radar tiles.
- **Routes:** RideWithGPS API v1 (API client key + auth token, stored as Worker secrets). To verify at build time: listing club/organization routes via the API; paste-link fallback always works.

## Architecture
- Cloudflare Worker + static assets (React + TypeScript + Vite) on ride.bbt.team.
- D1: spots, rides, route cache, settings, kit chart. KV: forecast cache.
- Editor routes/APIs gated by Cloudflare Access; viewer routes public.

## Backlog (post-v1)
1. **RWGPS route weather** (phase 2) — forecast at each point by ETA; head/tail/crosswind per segment.
2. **Shareable ride brief** — public link + copyable text.
3. **WhatsApp integration** (or other messenger) — post ride brief to group chat.
4. **Morning-of push alert** — PWA push N hours before ride.
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
