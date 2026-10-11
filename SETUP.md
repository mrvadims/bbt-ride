# Setup — accounts, tokens and secrets

Nothing here is ever committed. Values go into Cloudflare Worker secrets, GitHub repository secrets, or your local `.env` / `.dev.vars` (both git-ignored), never into the repo or chat.

| Step | Status |
|---|---|
| 1. Cloudflare API token | Done: GitHub repository secrets + local `.env` |
| 2. RideWithGPS credentials | Done: Worker secrets verified 2026-10-11 |
| 3. Google sign-in | Done 2026-10-11: app published, client created, `GOOGLE_CLIENT_SECRET` stored, first Admin chosen |
| 4. Web Push keys | When the app is built: generate and store `VAPID_PRIVATE_KEY` |

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

No DNS permission on purpose. When the Worker is ready, attach `ride.bbt.team` once by hand: Workers & Pages → bbt-ride → Settings → Domains & Routes → Add → Custom domain. Cloudflare creates the DNS record for you, and the deploy token never needs DNS edit rights.

**Where to put it:**
- GitHub: repository → Settings → Secrets and variables → Actions → add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The deploy workflow uses these.
- Your laptop: a `.env` file in the repo folder (git-ignored), read by Wrangler:
  ```
  CLOUDFLARE_API_TOKEN=your-token
  CLOUDFLARE_ACCOUNT_ID=your-account-id
  ```
- Don't put them in the Claude environment's variables (visible to anyone using the environment) or in chat.
- Check: `npx wrangler whoami` should show your account. "Invalid access token" means the value in `.env` is wrong or a stale `CLOUDFLARE_API_TOKEN` is set in your shell.

## 2. RideWithGPS credentials (API key, secret, auth token)

These are stored as **Cloudflare Worker secrets**. Only the Worker reads them; the browser never sees them.

From your own terminal, in the repo folder (Wrangler uses the token in `.env`):
```
npx wrangler secret put RWGPS_API_KEY    --name bbt-ride
npx wrangler secret put RWGPS_API_SECRET --name bbt-ride
npx wrangler secret put RWGPS_AUTH_TOKEN --name bbt-ride
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET --name bbt-ride
npx wrangler secret list --name bbt-ride     # names only
```
Each command prompts for the value, so it never lands in shell history or the repo. Secrets are write-only: Cloudflare won't show them again. To rotate, run the same command with the new value.

The first `secret put` offers to create the empty `bbt-ride` Worker; the first deploy replaces its code and keeps the secrets.

For local development, put the same names in `.dev.vars` (git-ignored). `.dev.vars.example` lists them with empty values.

## 3. Google sign-in (OAuth client)

Google keeps this under **Google Auth Platform** (APIs & Services → OAuth consent screen opens it). Use a Google account the team can keep long term; add a second owner later under IAM & Admin → IAM.

1. console.cloud.google.com → project picker → **New project** `bbt-ride` → Create, and select it.
2. **Google Auth Platform → Get started:** app name `BBT Ride`, support email, audience **External**, contact email → Create.
3. **Branding** (all of this is needed before you can publish):
   - Application home page: `https://ride.bbt.team`
   - Application privacy policy link: `https://ride.bbt.team/privacy` (the page is `public/privacy.html`)
   - Authorized domains: `bbt.team`
   - Developer contact information: your email (bottom of the page)
   - No logo: a logo makes Google require brand verification.
   - **Save.**
4. **Data Access:** add nothing; `openid`, `email` and `profile` are allowed by default.
5. **Audience → Publish app → Confirm**, so the status reads **In production**. With only those basic scopes there's no Google review. (In "Testing", only listed test users can sign in.)
6. **Clients → Create client → Web application**, name `bbt-ride web`:
   - Authorized JavaScript origins: `https://ride.bbt.team`, `http://localhost:8787`
   - Authorized redirect URIs: `https://ride.bbt.team/api/auth/callback/google`, `http://localhost:8787/api/auth/callback/google`
   - **Create.** Copy the client secret now (or Download JSON): Google shows it only once. If it's lost, use **Add secret** on the client and disable the old one.
7. Store the secret from your terminal, then add the same line to `.dev.vars` for local development:
   ```
   npx wrangler secret put GOOGLE_CLIENT_SECRET --name bbt-ride
   npx wrangler secret list --name bbt-ride     # should list 5 names
   ```
   `GOOGLE_CLIENT_ID` and `BOOTSTRAP_ADMIN_EMAIL` aren't secret; they go in `wrangler.toml` `[vars]`.
   Client ID: `788843663115-civobe823j0r2vnkpgsjg7o8vqvik76c.apps.googleusercontent.com`
   First Admin (`BOOTSTRAP_ADMIN_EMAIL`): `mrvadims@gmail.com`

"redirect_uri_mismatch" at sign-in means a redirect URI above doesn't match exactly (https, no trailing slash).

Password sign-in needs no extra setup: it runs in the Worker and uses `SESSION_SECRET` (already set).

## 4. Web Push keys (ride notifications)

Generate a key pair once, from your own terminal:
```
npx web-push generate-vapid-keys
npx wrangler secret put VAPID_PRIVATE_KEY --name bbt-ride   # paste the private key
```
The public key isn't secret; it goes in `wrangler.toml` `[vars]` as `VAPID_PUBLIC_KEY`.
