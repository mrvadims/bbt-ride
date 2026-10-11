# Decisions

Every open question from the design review, with what was decided. Details live in [DESIGN.md](DESIGN.md).

## Brand
| Topic | Decision | Date |
|---|---|---|
| Navy | `#020C2B` dark-mode background; `#03144D` text on light and dark-mode cards; `#1C367B` not used | 2026-10-09 |
| Header | Light-blue bar, white bike logo, 4px orange stripe directly under it, no hairline (checked on a phone), no text next to the logo | 2026-10-11 |
| Navigation | No tab row. Top bar: logo (home = Ride), Plan and Settings icons for roles that have them, account menu (theme, units, ride notifications, sign out) | 2026-10-11 |

## Weather model
| Topic | Decision | Date |
|---|---|---|
| Bike feel | Wind chill with airflow √(pace² + wind²), fading out between 50–70 °F, real feel above 70 °F | 2026-10-11 |
| Road wetness | Wet ≥ 0.5 mm film or raining; Drying ≥ 0.1 mm; 12 h look-back; Drying is an amber warning. Tune after real rides | 2026-10-09 |
| Warning thresholds | Cold < 40 / 32 °F bike feel; heat ≥ 92 / 100 °F real feel; wind ≥ 15 / 22; gusts ≥ 25 / 35; rain ≥ 30 / 60 % or ≥ 0.01 / 0.05"; thunder red | 2026-10-09 |
| No "Go" badge | Show warnings only when something needs attention | 2026-10-09 |
| NWS alerts | Add active NWS alerts for the spot's zone as warnings | 2026-10-11 |
| Coffee-stop forecast | None. Route weather along the course stays in the backlog | 2026-10-11 |
| Kit chart | Seven bike-feel bands plus add-ons; Admins edit it in Settings | 2026-10-09 |
| Units | Imperial by default; each rider can switch to metric | 2026-10-11 |

## Rides
| Topic | Decision | Date |
|---|---|---|
| Defaults | Roll-out 8:30; coffee stop 20 min (15–20 typical, one team setting); regroup buffer 5 % of moving time; all Admin settings | 2026-10-09 |
| Alternate routes | Free-text labels, pre-filled "Full" / "Short" | 2026-10-09 |
| Days | Saturday and Sunday tabs always; rides can be scheduled on any date | 2026-10-09 |
| Planning | One Plan flow: compare spots → pick a spot (or add one) → route → preview → Publish. No separate Weekend page | 2026-10-10 |
| Drafts | No Save draft button; the form autosaves. Edit, Update, Replace, Cancel and Restore ride | 2026-10-10 |
| RSVP | In / Out (route choice only for In on rides with an alternate); message thread with one-level replies | 2026-10-10 |
| RSVP reminders | None in v1 | 2026-10-11 |
| Notifications | Only when a ride is updated, cancelled or restored; Web Push only (opt-in per device), no email service | 2026-10-11 |
| History | Past tab on the Ride page; read-only past rides with observed weather; Reuse this plan | 2026-10-11 |

## Access and accounts
| Topic | Decision | Date |
|---|---|---|
| Sign-in | Google sign-in (main) plus username/email + password on the same account; invite-only; roles View / Edit / Admin | 2026-10-11 |
| Identity system | Better Auth inside the Worker, stored in D1 (free; no outside identity service) | 2026-10-11 |
| Forgotten password | Admin creates a one-time reset link in Settings → Users and sends it; no reset emails in v1 | 2026-10-11 |
| Uninvited accounts | Blocked with "Not invited — ask a team admin"; public sign-up off; invites are links the Admin sends | 2026-10-11 |
| Public pages | Only sign-in and a static `/privacy` page (Google requires a public privacy policy to publish the sign-in app); everything else requires sign-in | 2026-10-11 |
| RideWithGPS | API key, secret and auth token stored as Worker secrets (verified on the `bbt-ride` Worker) | 2026-10-11 |
| Cloudflare deploys | Scoped API token in GitHub repository secrets; deploy via GitHub Actions; `ride.bbt.team` attached by hand | 2026-10-10 |

## Notes
- **Prototype data.** In sandboxed previews (such as the private artifact) the prototype can't reach Open-Meteo or map tiles, so it shows the saved Oct 7–11 sample (yellow banner) and an outline map. Opened directly in a browser it fetches live. The real app fetches forecasts through the Worker.
- **Nearest spot.** Use the route's first track point to find the nearest start spot (the seed file's RWGPS start point differs by about 45 m).

## Still to do (outside the code)
- Web Push keys, the D1 database and KV namespace, then the first deploy (SETUP.md §4–6). Accounts and secrets are in place.
