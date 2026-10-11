# BBT Ride

Ride planning and hyperlocal weather for the BBT cycling team — hosted at ride.bbt.team.

See [DESIGN.md](DESIGN.md) for scope, features, algorithms and backlog.

## Prototype
Open `prototype/index.html` in a browser (single file, no build needed). It fetches Open-Meteo live and falls back to embedded sample data when offline.
To rebuild after editing `prototype/src/app.html`: `python3 prototype/build.py`.

Decisions: [DECISIONS.md](DECISIONS.md). Accounts, tokens and secrets: [SETUP.md](SETUP.md). Public privacy page: `public/privacy.html` (served at `/privacy`).
