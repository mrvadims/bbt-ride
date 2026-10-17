# Decisions

Every open question from the design review, with what was decided. Details live in [DESIGN.md](DESIGN.md).

## Brand
| Topic | Decision | Date |
|---|---|---|
| Navy | `#020C2B` dark-mode background; `#03144D` text on light and dark-mode cards; `#1C367B` not used | 2026-10-09 |
| Header | Light-blue bar, white bike logo, 4px orange stripe directly under it, no hairline (checked on a phone), no text next to the logo | 2026-10-11 |
| Wording | "Meet time" everywhere riders see a ride's start time (was "roll-out") | 2026-10-12 |
| Navigation | No tab row. Top bar: logo (home; v2: the upcoming list), Team (everyone, 2026-10-14), Plan and Settings icons for roles that have them, account menu (theme, units, notifications, new-activity sports, calendar link, my contact info, sign out) | 2026-10-11 |

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
| Days | Saturday and Sunday tabs always; rides can be scheduled on any date (superseded by v2 → Home: one upcoming list) | 2026-10-09 |
| Planning | One Plan flow: compare spots → pick a spot (or add one) → route → preview → Publish. No separate Weekend page | 2026-10-10 |
| Date picker | The app's own calendar in Plan: weeks start on Monday, Saturdays and Sundays shaded | 2026-10-12 |
| Calendar events | Location is the parking pin's coordinates (opens in Maps, works for car navigation); spot name and Maps link go in the description | 2026-10-12 |
| Drafts | No Save draft button; the form autosaves. Edit, Update, Replace, Cancel and Restore ride | 2026-10-10 |
| RSVP | In / Out (route choice only for In on rides with an alternate); message thread with one-level replies | 2026-10-10 |
| RSVP reminders | None in v1 | 2026-10-11 |
| Notifications | (v1; v2 adds new activities, mentions, deletions, new messages and @here) Only when a ride is updated, cancelled or restored; Web Push only (opt-in per device), no email service; delivered through a Cloudflare Queue in batches of 5 devices (v2: plus Firebase for the Android app; each person keeps their newest 10 devices) | 2026-10-12 |
| Notification audience | Every member who turned ride notifications on, whether or not they've answered In / Out | 2026-10-12 |
| Past activities | Past tab on the Ride page (v2: a Past activities link; latest 200); read-only past rides with recorded weather; Reuse this plan. Routes and times stay live (not frozen at publish) | 2026-10-12 |
| Edit conflicts | Update ride is refused if the ride changed after the editor opened it | 2026-10-12 |
| Start spots | Name, Google Maps link and parking notes all required (v2: notes optional). Settings lists spots with Open in Maps, Edit (in place), Archive and Add a spot; archived spots fold into a collapsed list | 2026-10-12 |
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
| Public pages | Only sign-in, the invite and reset link pages (valid token required) and a static `/privacy` page (Google requires a public privacy policy to publish the sign-in app); everything else requires sign-in (v2: also `/download/` and the signed calendar feed) | 2026-10-11 |
| RideWithGPS | API key and auth token stored as Worker secrets (verified on the `bbt-ride` Worker); the API secret isn't needed | 2026-10-12 |
| Cloudflare deploys | Scoped API token in GitHub repository secrets; deploy via GitHub Actions; `app.bbt.team` attached by hand | 2026-10-10 |
| Address | `app.bbt.team` (was `ride.bbt.team` while only the captain used it; the old address is detached, no forwarding) | 2026-10-13 |

## v2: any sport and phone apps (steps 1–3 built; the iPhone app waits on the Apple fee)
| Topic | Decision | Date |
|---|---|---|
| Name | The app becomes **BBT**; the address is `app.bbt.team`; app and notification icon = full bike logo on Light Blue | 2026-10-13 |
| Sports | Ride, Run, Swim, Pickleball, Ski, Other (+ Triathlon, 2026-10-14); Admins turn sports on or off; no custom sports beyond Other | 2026-10-13 |
| One team | Sports are a field on each activity, not separate groups; Edit and Admin plan any sport | 2026-10-13 |
| Home | One upcoming list, soonest first, with sport filters (shown only when more than one sport is coming up) and a Past activities link; replaces the day tabs | 2026-10-13 |
| Per day | One published activity per sport per day; a second one offers Replace, as in v1 (superseded 2026-10-14 by *Several activities per sport per day*) | 2026-10-13 |
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
| Leave-by alerts | Not now (backlog; would need location and a traffic API) | 2026-10-13 |
| Android build | Capacitor 8; one in-app plugin (version, Firebase, Google sign-in, share, open outside) rather than several npm plugins; data-only Firebase messages drawn by the app so Still in / I'm out work in the background | 2026-10-13 |
| APK hosting | Built in its own Deploy job and served with the site at /download/ (no Releases, R2 or KV); a failed Android build shows red but doesn't block the web deploy | 2026-10-13 |
| iPhone | The Home Screen web app for now, with an install hint in iPhone browsers (Not now = 30 days) and the Welcome sheet on first open; once the Apple fee ($99/year) or a nonprofit waiver is settled, the same Capacitor project with an unlisted App Store link | 2026-10-13 |
| Public site | One static page at www.bbt.team (and bbt.team) with Open BBT and the phone-app links; no sign-up, request-access form or contact address (invitation only); its own static Worker, separate from the app | 2026-10-13 |
| iPhone and Android equal | Two equal buttons on the home page, two matching cards on the download page (your phone first), "Install on iPhone / Android" in the account menu | 2026-10-13 |
| Members edit their own name | **Edit name** in the account menu (one display name, 1–80 characters; checked by the server). Invites carry only the email, and Google sign-ups start with their Google name | 2026-10-13 |
| Invite links, no email service | Kept: the Admin sends each link. Settings says so and offers **Email it** (their own mail app, message ready) and **Share…**. An email service (e.g. Resend) stays an option | 2026-10-14 |
| Notification delivery | Devices re-register on every app start; a failed send is retried once after a minute and logged with the push service's status | 2026-10-14 |
| Firebase key | A service account with only "Firebase Cloud Messaging API Admin", not the Admin SDK key | 2026-10-13 |
| Sport icons | Google Material Symbols (Rounded, Apache 2.0), copied in as SVG paths rather than custom drawings: every BBT sport has one, including pickleball, and about 40 more cover future sports. Other is a circle with three dots; an editor can pick another icon for an Other activity (stored per activity). Same shapes on www.bbt.team | 2026-10-14 |
| Tester feedback, first round | Built: going count + You're in on Home, place search in Plan, tappable links, one date field with weekend chips. Deferred: multi-day and all-day events, recurring events, a month view (until a real need shows) | 2026-10-14 |
| Triathlon | Added as a sport, on by default: race start/end, place, details, Other outdoor weather, no route. Icon made from Material's swim, run and bike shapes (Material has no triathlon icon). The database no longer fixes the list of sports; the API does | 2026-10-14 |
| Who created and changed an activity | A quiet, closed History panel at the end of the activity page and the Edit screen (design H of three rounds), built from the audit log; chosen over bylines and chips so the record doesn't compete with the activity | 2026-10-14 |
| Several activities per sport per day | Allowed for every sport (was one per sport per day). Plan says what's already posted and offers Publish another (main) or Replace (cancels the one named) | 2026-10-14 |
| New and unread markers | Design K1: a dot or message count on the sport icon plus a reason line; tracked per person on the server (synced across devices), with a baseline so existing activities start as seen | 2026-10-14 |
| Team directory | A **Team** icon in the top bar for everyone, plus names in Who's in that open a contact card with Call and Text (designs A + C; the account-menu link B not used) | 2026-10-14 |
| Contact details | Mobile phone required (asked once before anything else), emergency contact optional; everyone on the team sees both | 2026-10-14 |
| Mentions | @ plus a name picker; names only (no usernames); stored as user ids; the people mentioned are notified when it's posted (never on edits), even if they muted the sport; at most 10 per message | 2026-10-14 |
| Deleting activities | Its creator (while an Editor) and Admins, with a confirm sheet; RSVPs and messages go too; people going are told; the audit log keeps a record. Cancel stays for everyone else | 2026-10-14; creators 2026-10-15 |
| Replace's notification | A cancellation by Replace is told to everyone with notifications on, like any other cancellation | 2026-10-14 |
| Who sees contacts | Every member sees everyone's phone and emergency contact; only Admins see other people's roles (2026-10-16: in Settings → Users only, not in Team or contact cards); disabled members are hidden from Team and mentions (names kept for old mentions); the phone requirement is the app's, not the API's | 2026-10-14 |
| Visit tracking | Only opening the activity page counts as a visit (its own request); reading it in Plan or the 30 s refresh doesn't | 2026-10-14 |
| Game icons for Other | Chess (Material's knight), Cards (Material), Ping-pong (Tabler Icons, MIT, made solid to match), Billiards and Bowling (drawn to match). No emoji button: computers have their own picker (Windows + . / Control + Command + Space) | 2026-10-15 |
| Garmin help | A help page, Routes on your Garmin, reached from Help in the account menu; no link on the activity page | 2026-10-15 |
| Private activities | Public or Private, named so in Plan's Visibility; private ones only the people invited see, Admins included; invited Editors edit, invited Members answer and post; guest list changes after posting (added people are notified, removed ones aren't); guests see the whole guest list; only the creator's side adds people (no forwarding); private → public only; a small lock on the activity's icon. Enforced on the server, answering 404 to anyone else | 2026-10-15 |
| Announcements | Admins only; to everyone; a banner on every page until each person taps Got it (remembered per person, all devices); optional last day; a notification by default (a checkbox); "N of M got it" with who hasn't; recent ones (90 days) on an Announcements page in the account menu; one style | 2026-10-15 |
| Virtual meet-ups | A place can be online: its link is a meeting link (any https link; Zoom, Meet, Teams, Webex named). Any sport can be online: start and end times, route optional (rides and runs), no pace and no weather. Join replaces Directions; the calendar event links the meeting; no start reminder for now | 2026-10-15 |
| Release notes | Members only: dated pages in the app (/updates/<date>, What's new in the account menu), not on the public site | 2026-10-15 |
| HTTPS only | Every connection is HTTPS: Cloudflare redirects plain HTTP, the API refuses it, HSTS for a year with includeSubDomains (no preload), no cleartext in the Android app; calendar buttons keep `webcal:` links for simplicity | 2026-10-14 |
| Prototype | The v1 HTML prototype is removed (it predated v2); it stays in git history | 2026-10-14 |
| Roles in Team | Team list and contact cards show no roles, for Admins too; roles stay in Settings → Users, and `GET /api/team` no longer returns them | 2026-10-16 |
| Message threads | One `messages` table keyed by thread; a thread per owner (activities and date polls) with one nullable owner column per kind, so deleting an owner cascades; chosen over a generic owner pair (no foreign keys) and over mapping tables per owner (orphaned threads on delete, extra joins). Messages are their own panel below Who's in, open by default, previewing the latest while closed | 2026-10-17 |
| Date polls | Editors and Admins ask which date works: up to 14 options, single days or 2–4-day blocks, within 12 months; In / Maybe / Out per option with notes; Public or Private, the same Visibility choice as activities (private like activities, Admins included); results visible to everyone asked; Nudge; Plan this links the activity and closes the poll; each poll has a message thread; named "Date poll" (not "Who's in", which is the RSVP panel) | 2026-10-17 |
| Compact activity page | With every panel collapsed, a typical activity fits a 390 × 760 phone (iPhone 13–16, common Androids) without scrolling, checked by the browser smoke test; small phones and pages with banners or several warnings may scroll | 2026-10-17 |
| Message notifications | A thread notifies its followers (creator, In, on a poll In or Maybe, and posters; a sport turned off doesn't stop them), each can mute or follow it; @here (anyone who can post, no rate limit in an invite-only team) also reaches everyone else who can see it, except who muted the thread or turned the sport off; one card per thread until it's opened, later messages update it quietly; Android 1.3 for the replaced card. Chosen over notifying everyone (noisy) and mentions only (messages went unseen) | 2026-10-17 |
| Date poll rules (audit) | Options can't share a day; Plan this works once per poll while its activity exists (checked inside the publish batch); edits carry the copy they started from, so a stale save is refused; manage rights follow the activity rule (creator while an Editor, or an Admin); a planned poll names its activity, and the activity its poll, only to people who can see the other one. Android 1.2 lets a notification open `/polls/<id>` and `/announcements` | 2026-10-17 |

## Notes
- **Nearest spot.** Use the route's first track point to find the nearest start spot (the seed file's RWGPS start point differs by about 45 m).

## Still to do (outside the code)
- Try one password sign-in in production (Workers free plan CPU limit); check live route search and notifications.
