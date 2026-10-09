# Open questions — morning review (2026-10-09)

Each has a recommended default. Reply with the number and "ok" or your change. The prototype already uses every default.

**Resolved 2026-10-09:** 1 (split navy roles), 4 (Drying = Caution; tune after real rides), 5 (cold limits 40 / 32 kept), 6 (kit chart editable by Admins in Settings, stored in D1), 7 (20 min default; 15–20 typical), 8 (8:30 roll-out), 9 (Full / Short), 10 (regroup buffer, default 5 %, Admin setting), 11 (keep both days; rides can be on any date), 12 (Google sign-in + invite-only users table with Read / Edit / Admin roles), 13 (RWGPS credentials as Worker secrets; see SETUP.md), 14 (Cloudflare token steps in SETUP.md).

**Still open:** 2 (header edge on a real phone), 3 (bike feel formula), 15–19.

## Brand
1. ✅ **Resolved — split roles.** **Which navy is official?** The brand files have three: `#020C2B` (color sheet "Dark Blue"), `#03144D` (logo fill), `#1C367B` (in the PDF, not on the sheet).
   **Default:** `#020C2B` = dark-mode page background, `#03144D` = primary text on light + dark-mode cards, drop `#1C367B`.
2. **Blue/orange header edge.** The 4px orange stripe sits directly on Light Blue with no hairline. It looked fine in headless Chromium at 375px and 1280px; a real-phone check is still needed (shimmer risk, 1.25:1 brightness).
   **Default:** keep it without the hairline unless you see a shimmer on your phone; the fallback is a 2px white line.

## Weather model
3. **Bike feel formula and display.** Wind chill with airflow `√(pace² + wind²)`; the chill fades linearly to zero between 50 and 70 °F; above 70 °F it equals real feel (DESIGN.md → Bike feel). Shown as a min–max range for the ride window next to temp and real feel.
   **Default:** keep. Alternative: `pace + wind/2` (slightly colder in windy conditions).
4. ✅ **Resolved — Drying = Caution.** **Road-wet thresholds.** Wet if the water film is ≥ 0.5 mm or it is raining that hour; Drying if ≥ 0.1 mm; 12 h look-back. Drying coefficients are a first guess.
   **Default:** ship as is, then log the verdict next to what the team actually found on 4–6 rides and tune. Question for you: should **Drying** be Caution (current) or Go?
5. ✅ **Resolved — keep 40 / 32.** **Verdict thresholds.** Cold caution < 40 / no-go < 32 (bike feel); heat ≥ 92 / ≥ 100 (real feel); wind ≥ 15 / ≥ 22; gusts ≥ 25 / ≥ 35; rain chance ≥ 30 % / ≥ 60 %; rain ≥ 0.01" / ≥ 0.05"; thunder = No-go.
   **Default:** keep. The 32° bike-feel no-go is the one most likely to be too strict for this group.
6. ✅ **Resolved — Admins edit in Settings (D1).** **Kit chart defaults.** Seven bands on bike feel (≥70, 60s, 52–59, 45–51, 38–44, 30–37, <30) plus rain-jacket, fender/shoe-cover, wind-vest and shedding add-ons (DESIGN.md → Kit chart).
   **Default:** keep; editors tune it in Settings. Please look at the 45–59° bands, where opinions differ most.

## Rides
7. ✅ **Resolved — 20 min default (15–20).** **Coffee stop length.** **Default:** 20 min, editable per ride. It shifts the end of the ride window and every ETA after the stop.
8. ✅ **Resolved — 8:30 roll-out.** **Default roll-out time and duration.** **Default:** 8:00 roll-out, 3 h on the weekend board. Should the default change with the season, for example 9:00 from November to March?
9. ✅ **Resolved — Full / Short.** **Alternate route naming.** **Default:** free-text labels, pre-filled "Full" / "Short". Other options: "A / B", or naming by distance ("46 / 34").
10. ✅ **Resolved — configurable, default 5 %.** **Regroup buffer in ETAs.** ETAs use pure moving time (distance ÷ pace). Real rides run longer with regroups and lights.
    **Default:** no buffer in v1. Option: +5 % elapsed-time factor in Settings.
11. ✅ **Resolved — keep both days; any-date rides allowed.** **Sunday sample ride.** For the demo I added Armonk 8:30 on route 57215407, with BreadsNBakes as the stop. Is that a real pattern, or should Sunday usually be empty?

## Access and accounts (blocking the real build)
12. ✅ **Resolved — Google sign-in, invite-only `users` table, Read / Edit / Admin (DESIGN.md → Users and roles).** **Editor emails for Cloudflare Access.** Who besides you can edit? **Default:** just you until you send a list. Login by one-time PIN plus Google.
13. ✅ **Resolved — credentials exist; store as Worker secrets (SETUP.md §2).** **RWGPS API client for route-library search.** Listing your routes (`/users/157524/routes.json`) returns 403 without auth. The public group page `groups/BBT` exposes 36 route IDs, and public route JSON works without a key.
    **Default:** you create an API client at ridewithgps.com/api and give me the key; the auth token is stored as a Worker secret. Until then the editor searches the 36 group routes + seeds, and paste-link always works.
14. ✅ **Resolved — token steps in SETUP.md §1.** **Cloudflare account / wrangler access.** Needed to create the Worker, D1, KV and the `ride.bbt.team` route.
    **Default:** you create a scoped API token (Workers Scripts, D1, KV, Workers Routes: Edit on the bbt.team zone) and add it as an environment secret. I won't deploy or touch DNS without your go-ahead.

## Found while building
15. **Prototype hosting check.** I couldn't confirm the private artifact can reach Open-Meteo, RainViewer or the map tiles (network policy). If you see the yellow "Sample data" banner on your phone, that's why: the fallback is working. The real app proxies Open-Meteo through the Worker, so this goes away there.
16. **Forecast point for the board.** Each spot uses its own forecast point. The coffee stop uses the POI's point at its ETA. **Default:** keep. Per-segment route weather stays in the Phase 2 backlog.
17. **Seed "nearest spot" distance.** seed.json says 113 m for route 57426135; the editor computes 158 m from the first track point. The seed used RWGPS `first_lat/lng`. Harmless, but the live app should use one source. **Default:** use the first track point.
18. **Thunder and lightning data.** Open-Meteo's weather code is the only thunder signal. **Default:** fine for v1. Option: show NWS active alerts for the zone (free, no key).
19. **Units.** °F / mph / inches only in v1. **Default:** no metric toggle until someone asks for one.
20. **Public ride link.** Sign-in is now required for everything. Should a published ride page also have an optional public share link (no login), e.g. for guests joining one ride?
    **Default:** no public pages in v1; revisit with the "shareable ride brief" backlog item.
21. **Uninvited Google sign-ins.** **Default:** show "Not invited — ask a team admin" and don't create a row. Option: auto-create as Read with status `pending` for an Admin to approve.
