# Setup — accounts, tokens and secrets

Nothing here is ever committed. Values go into Cloudflare Worker secrets, GitHub repository secrets, or your local `.env` / `.dev.vars` (both git-ignored), never into the repo or chat.

| Step | Status |
|---|---|
| 1. Cloudflare API token | Done: GitHub repository secrets + local `.env` |
| 2. RideWithGPS credentials | Done: Worker secrets verified 2026-10-11 |
| 3. Google sign-in | Done 2026-10-11: app published, client created, `GOOGLE_CLIENT_SECRET` stored (verified), first Admin chosen |
| 4. Web Push keys | Done 2026-10-12: `VAPID_PRIVATE_KEY` stored as a Worker secret (verified), public key in `wrangler.jsonc` |
| 5. D1 database, KV namespace and Queue | D1 and KV done 2026-10-12; Queue created and deploy token updated 2026-10-12 |
| 6. First deploy | Deployed 2026-10-12; address `app.bbt.team` since 2026-10-13 |
| 7. Android app | To do: Firebase, signing key, Android sign-in client (below) |

## 1. Cloudflare API token (for deploys)

1. Sign in to dash.cloudflare.com → profile icon (top right) → **My Profile** → **API Tokens** → **Create Token**.
2. Next to **Edit Cloudflare Workers**, click **Use template**.
3. **Token name:** `bbt-ride deploy`.
4. **Permissions:** keep the template rows and add one row for D1. The final list:

   | Scope | Resource | Access |
   |---|---|---|
   | Account | Workers Scripts | Edit |
   | Account | Workers KV Storage | Edit |
   | Account | **D1** | **Edit** (add this row) |
   | Account | **Queues** | **Edit** (add this row) |
   | Account | Account Settings | Read |
   | Account | Workers Tail | Read |
   | User | User Details | Read |
   | User | Memberships | Read |
   | Zone | Workers Routes | Edit |
   | Zone | Zone | Read |

   Remove **Workers R2 Storage** if the template includes it; we don't use R2.
5. **Account Resources:** Include → *your account only* (not "All accounts").
6. **Zone Resources:** Include → Specific zone → **bbt.team**.
7. **TTL:** set an end date, for example 12 months out.
8. **Create Token**, then copy it. Cloudflare shows it only once.
9. Copy your **Account ID**: Workers & Pages → Overview, right sidebar.

No DNS permission on purpose: the domain is attached once by hand (step 6.2), so the deploy token never needs DNS edit rights.

**Where to put it:**
- GitHub: repository → Settings → Secrets and variables → Actions → add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The deploy workflow uses these.
- Your laptop: a `.env` file in the repo folder (git-ignored), read by Wrangler:
  ```
  CLOUDFLARE_API_TOKEN=your-token
  CLOUDFLARE_ACCOUNT_ID=your-account-id
  ```
- Don't put them in the Claude environment's variables (visible to anyone using the environment) or in chat.
- Check: `npx wrangler whoami` should show your account. "Invalid access token" means the value in `.env` is wrong or a stale `CLOUDFLARE_API_TOKEN` is set in your shell.

## 2. Worker secrets: RideWithGPS and session

These are stored as **Cloudflare Worker secrets**. Only the Worker reads them; the browser never sees them.

From your own terminal, in the repo folder (Wrangler uses the token in `.env`):
```
npx wrangler secret put RWGPS_API_KEY    --name bbt-ride
npx wrangler secret put RWGPS_AUTH_TOKEN --name bbt-ride
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET --name bbt-ride
npx wrangler secret list --name bbt-ride     # names only
```
The app doesn't use the RideWithGPS API secret. If you stored it earlier, you can remove it: `npx wrangler secret delete RWGPS_API_SECRET --name bbt-ride`.
The key and token commands prompt for the value (`SESSION_SECRET` is generated and piped in), so no value lands in shell history or the repo. Secrets are write-only: Cloudflare won't show them again. To rotate, run the same command with the new value.

The first `secret put` offers to create the empty `bbt-ride` Worker; the first deploy replaces its code and keeps the secrets.

For local development, put the same names in `.dev.vars` (git-ignored). `.dev.vars.example` lists them with empty values.

## 3. Google sign-in (OAuth client)

Google keeps this under **Google Auth Platform** (APIs & Services → OAuth consent screen opens it). Use a Google account the team can keep long term; add a second owner later under IAM & Admin → IAM.

1. console.cloud.google.com → project picker → **New project** `bbt-ride` → Create, and select it.
2. **Google Auth Platform → Get started:** app name `BBT` (created as `BBT Ride`; rename it under **Branding** if it still shows that), support email, audience **External**, contact email → Create.
3. **Branding** (all of this is needed before you can publish):
   - Application home page: `https://app.bbt.team`
   - Application privacy policy link: `https://app.bbt.team/privacy` (the page is `public/privacy.html`)
   - Authorized domains: `bbt.team`
   - Developer contact information: your email (bottom of the page)
   - No logo: a logo makes Google require brand verification.
   - **Save.**
4. **Data Access:** add nothing; `openid`, `email` and `profile` are allowed by default.
5. **Audience → Publish app → Confirm**, so the status reads **In production**. With only those basic scopes there's no Google review. (In "Testing", only listed test users can sign in.)
6. **Clients → Create client → Web application**, name `bbt-ride web`:
   - Authorized JavaScript origins: `https://app.bbt.team`, `http://localhost:8787`
   - Authorized redirect URIs: `https://app.bbt.team/api/auth/callback/google`, `http://localhost:8787/api/auth/callback/google`
   - **Create.** Copy the client secret now (or Download JSON): Google shows it only once. If it's lost, use **Add secret** on the client and disable the old one.
7. Store the secret from your terminal, then add the same line to `.dev.vars` for local development:
   ```
   npx wrangler secret put GOOGLE_CLIENT_SECRET --name bbt-ride
   npx wrangler secret list --name bbt-ride     # should list 4 names (5 if RWGPS_API_SECRET is still there)
   ```
   `GOOGLE_CLIENT_ID` and `BOOTSTRAP_ADMIN_EMAIL` aren't secret; they go in `wrangler.jsonc` under `vars`.
   Client ID: `788843663115-civobe823j0r2vnkpgsjg7o8vqvik76c.apps.googleusercontent.com`
   First Admin (`BOOTSTRAP_ADMIN_EMAIL`): `mrvadims@gmail.com`

"redirect_uri_mismatch" at sign-in means a redirect URI above doesn't match exactly (https, no trailing slash).

Password sign-in needs no extra setup: it runs in the Worker and uses `SESSION_SECRET` (already set).

## 4. Web Push keys (notifications)

Generate a key pair once, from your own terminal:
```
npx web-push generate-vapid-keys
npx wrangler secret put VAPID_PRIVATE_KEY --name bbt-ride   # paste the private key
```
The public key isn't secret; it goes in `wrangler.jsonc` under `vars` as `VAPID_PUBLIC_KEY` (`VAPID_SUBJECT` is already `mailto:info@bbt.team`). Without the keys the app works; the "Notifications" switch just says "Not set up yet".

## 5. D1 database, KV namespace and Queue

From your own terminal, in the repo folder:
```
npx wrangler d1 create bbt-ride
npx wrangler kv namespace create CACHE
npx wrangler queues create bbt-ride-push
```
The first two print an id. Put them in `wrangler.jsonc`: the D1 id as `database_id` and the KV id as `id`, then commit. The ids aren't secret (done: both are in `wrangler.jsonc`). The Queue (notifications) is referenced by name, so it needs no id; it's on the Workers free plan.

The deploy token also needs **Account → Queues → Edit** so `wrangler deploy` can attach the Worker to the Queue: My Profile → API Tokens → `bbt-ride deploy` → **Edit** → add the row → **Continue to summary** → **Update Token**. The token's value doesn't change.

Backups: D1 Time Travel is on by default (restore to any minute in the last 7 days on the free plan).

## 6. First deploy

1. Merge the app into `main`. The Deploy workflow runs the checks, applies the D1 migrations (tables, the three start spots, the club route library, the kit chart) and deploys the Worker.
2. Attach the domain once: Workers & Pages → bbt-ride → **Domains** tab → add a Custom domain → `app.bbt.team`. It stays in the dashboard, not in `wrangler.jsonc`: declaring it there would make every deploy need DNS rights on the token.
3. Open https://app.bbt.team and **Continue with Google** as the first Admin (`BOOTSTRAP_ADMIN_EMAIL`). Then invite the team from Settings → Users.
4. The route library fills over about 2.5 days (2 routes per run; the scheduled job runs every 3 hours); route search lists a route once it's fetched, and a pasted RideWithGPS link always works. Check that searching for a club route works; if your own private routes don't appear, the RideWithGPS list endpoint needs adjusting (DESIGN.md → Data sources).


## 7. Android app

The deploy builds the Android app and puts it on https://app.bbt.team/download/ once these secrets exist (DESIGN.md → v2, Android app). Until then the deploy skips the app and the download page says it isn't available yet. Everything here is free. Do A–C in the same Google Cloud project as the web sign-in client (`bbt-ride`).

### A. Firebase (notifications)

1. console.firebase.google.com → **Create a project** → choose the existing Google Cloud project **bbt-ride** (not a new one) → Google Analytics **off** → Create. The free Spark plan is enough.
2. Project overview → **Add app** → Android: package name `team.bbt.app`, nickname `BBT` → **Register app** → **Download google-services.json** → skip the remaining SDK steps (already done in the code).
3. GitHub → repository **Settings → Secrets and variables → Actions → New repository secret**: name `GOOGLE_SERVICES_JSON`, value the whole content of `google-services.json`.
4. A service account that can only send notifications (not Firebase's all-powerful "Admin SDK" key): console.cloud.google.com → project **bbt-ride** → **IAM & Admin → Service accounts → Create service account**: name `bbt-push` → **Create and continue** → role **Firebase Cloud Messaging API Admin** → **Done**. Open `bbt-push` → **Keys → Add key → Create new key → JSON**. From your terminal, in the repo folder:
   ```
   npx wrangler secret put FCM_SERVICE_ACCOUNT --name bbt-ride < ~/Downloads/<the downloaded file>.json
   ```
   Then delete the downloaded file. For local development, add the same JSON on one line as `FCM_SERVICE_ACCOUNT=` in `.dev.vars` (optional). (Firebase → Project settings → **Cloud Messaging** should show "Firebase Cloud Messaging API (V1): Enabled", the default.)

### B. Signing key (keep it forever)

Every version of the app must be signed with the same key, or phones refuse the update and people have to uninstall first. From your terminal (needs Java; on a Mac without it: `brew install openjdk`):
```
keytool -genkeypair -v -keystore bbt-release.jks -alias bbt -keyalg RSA -keysize 2048 -validity 10000 -storetype PKCS12
keytool -list -v -keystore bbt-release.jks -alias bbt | grep SHA1     # the SHA-1 for step C
base64 -i bbt-release.jks | pbcopy                                     # copies the key for the secret below
```
Choose a strong password when asked (it's both the store and the key password). Add four GitHub repository secrets: `ANDROID_KEYSTORE_BASE64` (paste), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` = `bbt`, `ANDROID_KEY_PASSWORD` (the same password). Keep `bbt-release.jks` and the password in your password manager, never in the repo.

### C. Android sign-in client (Google sign-in in the app)

console.cloud.google.com → project **bbt-ride** → **Google Auth Platform → Clients → Create client → Android**: name `bbt-ride android`, package name `team.bbt.app`, SHA-1 from step B → **Create**. There's nothing to copy: the app asks Google for a token for the web client (its ID is in `capacitor.config.ts`), and Google allows it because the app's package and signature match this client. A debug build you make yourself is signed with your own debug key: for Google sign-in there, add a second Android client with that SHA-1 (`keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`).

### D. Build and try it

1. Merge any change to `main` (or re-run the last Deploy). The Deploy run's **android** job should print `Built BBT for Android <versionName> (<versionCode>), <size>`, e.g. `1.1 (2)`.
2. On an Android phone open https://app.bbt.team/download/, install, sign in with Google, turn on notifications, and have someone post an activity or edit one you're In for (Still in / I'm out).
3. A new native version (only when `android/` changes): bump `versionCode` and `versionName` in `android/app/build.gradle`; installed apps then show "Update available".
