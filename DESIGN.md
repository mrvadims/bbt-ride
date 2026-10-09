# BBT Ride Weather — Design

Status: **in design** (not yet building). Last updated 2026-10-08.
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

## Open questions
- Usual start spots (name + Google Maps parking link + notes) to seed.
- See chat for current round of questions.
