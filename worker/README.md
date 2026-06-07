# HavenNest API Worker

Standalone Cloudflare Worker that powers the rental application and contact form
for the GitHub Pages site. Handles Turnstile verification, document uploads to a
private R2 bucket, server-side validation, and emailing the owner via Cloudflare
Email Routing — all on free tiers.

## Endpoints

| Method | Path               | Purpose |
| ------ | ------------------ | ------- |
| POST   | `/api/apply-begin` | Verify Turnstile, return a submission id + short-lived upload JWT |
| POST   | `/api/upload`      | (JWT) Validate + store one document in R2 (magic-byte sniff, 10 MB cap) |
| POST   | `/api/apply`       | (JWT) Validate the application (Zod), email the owner with signed file links |
| POST   | `/api/contact`     | Verify Turnstile, email the owner the enquiry |
| GET    | `/api/file`        | Stream a document from R2 via a signed, time-limited link (used in the owner email) |

CORS is locked to the origins in `ALLOWED_ORIGINS`. Uploads are scoped to the
JWT's submission id; `/api/apply` rejects document keys from other submissions.

## Local development

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars   # already has Turnstile test secret + DISABLE_EMAIL=1
npm run dev                       # http://127.0.0.1:8787  (R2 + email simulated locally)
```

Run the integration test from the repo root (worker must be running):

```bash
node scripts/e2e-worker.mjs
```

## One-time production setup

1. **Create the R2 bucket** and a retention lifecycle rule:
   ```bash
   wrangler r2 bucket create havennest-applications
   ```
   In the dashboard, add an Object lifecycle rule to delete objects after your
   retention window (e.g. 90 days).

2. **Enable Email Routing** on `havennest.ca` and **verify the owner inbox** as a
   destination address. Update `OWNER_EMAIL` (the verified destination) and
   `FROM_EMAIL` (an address on `havennest.ca`) in `wrangler.toml`, and set the
   same verified address as `destination_address` under `[[send_email]]`.

3. **Create a Turnstile widget** for `havennest.ca`; put the **site key** in the
   site (`src/data/site.ts` → `turnstileSiteKey`) and set the **secret** here.

4. **Set secrets:**
   ```bash
   wrangler secret put TURNSTILE_SECRET
   wrangler secret put JWT_SECRET            # any long random string
   wrangler secret put FILE_SIGNING_SECRET   # any long random string
   ```

5. **Deploy** and bind the custom domain:
   ```bash
   wrangler deploy
   ```
   Add an `api` subdomain route (uncomment `[[routes]]` in `wrangler.toml`, or add
   a Custom Domain `api.havennest.ca` in the dashboard). Confirm `PUBLIC_API_BASE`
   matches (`https://api.havennest.ca`) and that the site's `apiBase` points to it.

6. **Recommended:** add a Cloudflare WAF **Rate Limiting Rule** on `/api/*`
   (e.g. 10 requests/min/IP) instead of a KV counter, to stay within free limits.

## Notes
- The owner email contains **signed, expiring links** to the documents (default
  14 days), not attachments — keeps messages small and access controlled.
- Treat the owner inbox as sensitive: enable 2FA and purge old application emails
  per your retention policy (PIPA/PIPEDA).
