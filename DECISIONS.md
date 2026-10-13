# Decisions

Every open question from the design review, with what was decided. Details live in [DESIGN.md](DESIGN.md).

## Brand
| Topic | Decision | Date |
|---|---|---|
| Navy | `#020C2B` dark-mode background; `#03144D` text on light and dark-mode cards; `#1C367B` not used | 2026-10-09 |
| Header | Light-blue bar, white bike logo, 4px orange stripe directly under it, no hairline (checked on a phone), no text next to the logo | 2026-10-11 |
| Wording | "Meet time" everywhere riders see a ride's start time (was "roll-out") | 2026-10-12 |
| Navigation | No tab row. Top bar: logo (home = Ride), Plan and Settings icons for roles that have them, account menu (theme, units, notifications, new-activity sports, calendar link, sign out) | 2026-10-11 |

## Weather model
| Topic | Decision | Date |
|---|---|---|
| Bike feel | Wind chill with airflow √(pace² + wind²), fading out between 50–70 °F, real feel above 70 °F | 2026-10-11 |
| Road wetness | Wet ≥ 0.5 mm film or raining; Drying ≥ 0.1 mm; 12 h look-back; Drying is an amber warning. Tune after real rides | 2026-10-09 |
| Warning thresholds | Cold < 40 / 32 °F bike feel; heat ≥ 92 / 100 °F real feel; wind ≥ 15 / 22; gusts ≥ 25 / 35; rain ≥ 30 / 60 % or ≥ 0.01 / 0.05"; thunder red | 2026-10-09 |
| No "Go" badge | Show warnings only when something needs attention | 2026-10-09 |
| NWS alerts | Add active NWS alerts at the spot's location (by point) as warnings | 2026-10-11 |
| Coffee-stop forecast | None. Route weather along the course stays in the backlog | 2026-10-11 |
| Kit chart | Seven bike-feel bands plus add-ons; Admins edit it in Settings | 2026-10-09 |
| Units | Imperial by default; each rider can switch to metric | 2026-10-11 |
| Forecast outages | Forecasts and alerts are cached per spot; on an upstream failure each spot keeps its last good copy (6 h), a spot without one shows no forecast, and the rest keep working | 2026-10-12 |

## Rides
| Topic | Decision | Date |
|---|---|---|
| Defaults | Meet time 8:30; coffee stop 20 min (15–20 typical, one team setting); regroup buffer 5 % of moving time; all Admin settings | 2026-10-09 |
| Alternate routes | Free-text labels, pre-filled "Full" / "Short" | 2026-10-09 |
| Days | Saturday and Sunday tabs always; rides can be scheduled on any date | 2026-10-09 |
| Planning | One Plan flow: compare spots → pick a spot (or add one) → route → preview → Publish. No separate Weekend page | 2026-10-10 |
| Date picker | The app's own calendar in Plan: weeks start on Monday, Saturdays and Sundays shaded | 2026-10-12 |
| Calendar events | Location is the parking pin's coordinates (opens in Maps, works for car navigation); spot name and Maps link go in the description | 2026-10-12 |
| Drafts | No Save draft button; the form autosaves. Edit, Update, Replace, Cancel and Restore ride | 2026-10-10 |
| RSVP | In / Out (route choice only for In on rides with an alternate); message thread with one-level replies | 2026-10-10 |
| RSVP reminders | None in v1 | 2026-10-11 |
| Notifications | Only when a ride is updated, cancelled or restored; Web Push only (opt-in per device), no email service; delivered through a Cloudflare Queue in batches of 5 devices, to stay inside the free plan's CPU limit (no device limit) | 2026-10-12 |
| Notification audience | Every member who turned ride notifications on, whether or not they've answered In / Out | 2026-10-12 |
| History | Past tab on the Ride page (latest 200); read-only past rides with recorded weather; Reuse this plan. Routes and times stay live (not frozen at publish) | 2026-10-12 |
| Edit conflicts | Update ride is refused if the ride changed after the editor opened it | 2026-10-12 |
| Start spots | Name, Google Maps link and parking notes all required. Settings lists spots with Open in Maps, Edit (in place), Archive and Add a spot; archived spots fold into a collapsed list | 2026-10-12 |
| Settings layout | One column of panels on every screen width, so an open panel never leaves a gap beside it; fields in a row line up at the input | 2026-10-12 |

## Access and accounts
| Topic | Decision | Date |
|---|---|---|
| Sign-in | Google sign-in (main) plus username/email + password on the same account; invite-only; roles View / Edit / Admin | 2026-10-11 |
| Identity system | Better Auth inside the Worker, stored in D1 (free; no outside identity service) | 2026-10-11 |
| Free plan | Stay on the Workers free plan: notifications via a Queue, 2 library routes per scheduled run, one password hash per request (invite/reset links then go to sign-in) | 2026-10-12 |
| Admin endpoints | Better Auth's own admin endpoints are blocked; user management goes through the app's API (checks + audit) | 2026-10-12 |
| Forgotten password | Admin creates a one-time reset link in Settings → Users and sends it; no reset emails in v1 | 2026-10-11 |
| Uninvited accounts | Blocked with "Not invited — ask a team admin"; public sign-up off; invites are links the Admin sends | 2026-10-11 |
| Public pages | Only sign-in, the invite and reset link pages (valid token required) and a static `/privacy` page (Google requires a public privacy policy to publish the sign-in app); everything else requires sign-in | 2026-10-11 |
| RideWithGPS | API key and auth token stored as Worker secrets (verified on the `bbt-ride` Worker); the API secret isn't needed | 2026-10-12 |
| Cloudflare deploys | Scoped API token in GitHub repository secrets; deploy via GitHub Actions; `app.bbt.team` attached by hand | 2026-10-10 |
| Address | `app.bbt.team` (was `ride.bbt.team` while only the captain used it; the old address is detached, no forwarding) | 2026-10-13 |

## v2: any sport and phone apps (step 1 built; the rest designed)
| Topic | Decision | Date |
|---|---|---|
| Name | The app becomes **BBT**; the address is `app.bbt.team`; app and notification icon = full bike logo on Light Blue | 2026-10-13 |
| Sports | Ride, Run, Swim, Pickleball, Ski, Other; Admins turn sports on or off; no custom sports beyond Other | 2026-10-13 |
| One team | Sports are a field on each activity, not separate groups; Edit and Admin plan any sport | 2026-10-13 |
| Home | One upcoming list, soonest first, with sport filters (shown only when more than one sport is coming up) and a Past activities link; replaces the day tabs | 2026-10-13 |
| Per day | One published activity per sport per day; a second one offers Replace, as in v1 | 2026-10-13 |
| Plan fields | Sport first; title optional (defaults to route or sport name); end time per sport; pace for ride and run, one Details line for the rest; indoor/outdoor for swim (Pool / Open water), pickleball and other | 2026-10-13 |
| Places | Where = a saved place or a pasted Google Maps pin; v1 spots, with notes now optional | 2026-10-13 |
| Routes | Ride and run take a RideWithGPS route (search or pasted link); Open in RideWithGPS is a tile with RideWithGPS's vertical logo, no extra text | 2026-10-13 |
| Buttons | Three kinds everywhere: primary (filled, one per screen), secondary (outlined text), tiles (icon over one word). Every activity has one action row: Directions · Calendar · Share · RideWithGPS (when there's a route) | 2026-10-13 |
| Weather | Thresholds per weather group (Ride, Run, Ski, Other outdoor), all with the same factors; ride adds road wetness, ride and run add low light; cold uses bike feel, run feel or wind chill; indoor = no weather check; kit chart stays ride-only; still no "Good" badge | 2026-10-13 |
| Spots limit | Not now (backlog: optional cap with waitlist) | 2026-10-13 |
| Notifications | Adds New activity posted, sent only to people following that sport (per-sport switches in the account menu, all on by default); changes and cancellations still go to everyone with notifications on | 2026-10-13 |
| Calendar | A private per-person calendar link (everything you're In for, self-updating); no native calendar permission | 2026-10-13 |
| Calendar link security | Signed link (HMAC of person + version with the Worker secret), only the version stored; Reset bumps it; includes the last 30 days and upcoming, cancelled ones marked cancelled | 2026-10-13 |
| Notification buttons | Still in / I'm out on changes to activities you're In for; I'm out answers from the notification, Still in only closes it | 2026-10-13 |
| Native approach | Capacitor around the existing web app; the app loads `app.bbt.team`, so web deploys reach it without a new APK | 2026-10-13 |
| Android | Signed APK from a download page on app.bbt.team, built by GitHub Actions; push via Firebase (free); native Google sign-in; no Play account for now | 2026-10-13 |
| iPhone | Stays the Home Screen web app until the Apple fee ($99/year) or a nonprofit waiver is settled; then the same Capacitor project, unlisted App Store link | 2026-10-13 |
| Leave-by alerts | Not now (backlog; would need location and a traffic API) | 2026-10-13 |
| Android build | Capacitor 8; one in-app plugin (version, Firebase, Google sign-in, share, open outside) rather than several npm plugins; data-only Firebase messages drawn by the app so Still in / I'm out work in the background | 2026-10-13 |
| APK hosting | Built in the Deploy workflow and served with the site at /download/ (no Releases, R2 or KV); a failed Android build doesn't block the web deploy | 2026-10-13 |

## Notes
- **Prototype data.** In sandboxed previews (such as the private artifact) the prototype can't reach Open-Meteo or map tiles, so it shows the saved Oct 7–11 sample (yellow banner) and an outline map. Opened directly in a browser it fetches live. The real app fetches forecasts through the Worker.
- **Nearest spot.** Use the route's first track point to find the nearest start spot (the seed file's RWGPS start point differs by about 45 m).

## Still to do (outside the code)
- Try one password sign-in in production (Workers free plan CPU limit); check live route search and notifications.
