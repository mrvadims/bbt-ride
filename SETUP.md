# Setup — accounts, tokens and secrets

Nothing here is ever committed. Values go into Cloudflare Worker secrets or the Claude Code environment, never into the repo or chat.

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

**Where to put it:** in this Claude Code cloud environment's settings (cloud environment menu in the session title bar → Edit), add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` under Network secrets, or as environment variables if that section isn't offered. A new session picks them up. Don't paste them into chat.

## 2. RideWithGPS credentials (API key, secret, auth token)

These are stored as **Cloudflare Worker secrets**. Only the Worker reads them; the browser never sees them.

From your own terminal, in the repo, after `wrangler login` (or with the token above):
```
npx wrangler secret put RWGPS_API_KEY
npx wrangler secret put RWGPS_API_SECRET
npx wrangler secret put RWGPS_AUTH_TOKEN
```
Each command prompts for the value, so it never lands in shell history or the repo. Secrets are write-only: Cloudflare won't show them again. To rotate, run the same command with the new value.

For local development, put the same three names in `.dev.vars` (already git-ignored). `.dev.vars.example` lists the names with empty values.

The Worker needs to exist before `wrangler secret put` works, so this happens right after the first deploy. Until then, keep the values in your password manager.

## 3. Google sign-in (OAuth client)

1. console.cloud.google.com → create a project `bbt-ride` (or reuse one).
2. **APIs & Services → OAuth consent screen:** External, app name "BBT Ride", support email yours, scopes `openid email profile` only. Publishing status: In production. With only these basic scopes, Google doesn't require verification.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorized JavaScript origins: `https://ride.bbt.team`, `http://localhost:8787`
   - Authorized redirect URIs: `https://ride.bbt.team/auth/callback`, `http://localhost:8787/auth/callback`
4. Store the values:
   ```
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET      # any 32+ random bytes, e.g. `openssl rand -base64 32`
   ```
   `GOOGLE_CLIENT_ID` and `BOOTSTRAP_ADMIN_EMAIL` aren't secret; they go in `wrangler.toml` `[vars]`.
