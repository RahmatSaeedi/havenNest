# HavenNest — Production Deployment Guide

This walks you through putting the site live on **havennest.ca** end-to-end, all on
**free tiers**. Do the parts in order. Allow ~1–2 hours the first time (mostly DNS
propagation and account setup).

**Architecture recap**
- **Static site** (Astro) → built by **GitHub Actions** → served by **GitHub Pages**.
- **Cloudflare** sits in front for DNS, CDN and TLS, and runs the **API Worker** at `api.havennest.ca`.
- **Sveltia CMS** at `/admin` edits listings (commits to GitHub → auto-rebuild).

**You will need**
- A **GitHub** account, and **git** + **Node 20+** installed locally.
- A **Cloudflare** account with **havennest.ca** added (domain's nameservers pointed at Cloudflare).
- About 6 secrets/keys created along the way (kept out of git).

---

## Part A — Push the site to GitHub

1. Generate the image/brand assets locally and commit them (CI does not regenerate):
   ```bash
   npm install
   npm run assets        # optimizes /Photographs + builds favicons/marks
   npm run build         # sanity check it builds
   ```
2. Create a new GitHub repo (e.g. `havennest`) and push:
   ```bash
   git init
   git add .
   git commit -m "Initial HavenNest site"
   git branch -M main
   git remote add origin https://github.com/<your-user>/havennest.git
   git push -u origin main
   ```
   > `.gitignore` already excludes `node_modules`, `dist`, the 365 MB `Photographs/`
   > originals, and secrets. The web-optimized images **are** committed.
3. In GitHub → **Settings → Pages** → **Build and deployment → Source: GitHub Actions**.
   The included `.github/workflows/deploy.yml` builds and deploys on every push to `main`.
   Watch the first run under the repo's **Actions** tab; it publishes to a
   `*.github.io` URL and (after Part B) to havennest.ca.

---

## Part B — Point havennest.ca at GitHub Pages (via Cloudflare)

1. In **Cloudflare → DNS**, add records for the apex and www:
   - `A  havennest.ca  185.199.108.153`
   - `A  havennest.ca  185.199.109.153`
   - `A  havennest.ca  185.199.110.153`
   - `A  havennest.ca  185.199.111.153`
   - `CNAME  www  <your-user>.github.io`
   Leave them **Proxied** (orange cloud).
2. In **Cloudflare → SSL/TLS**: set encryption mode to **Full** (switch to **Full (strict)**
   once GitHub has issued its certificate — usually within an hour). Enable
   **Always Use HTTPS** and, under **Edge Certificates**, turn on **HSTS**.
3. The repo already contains `public/CNAME` (`havennest.ca`). In GitHub → **Settings → Pages**,
   confirm the **Custom domain** shows `havennest.ca` and tick **Enforce HTTPS** once available.
4. Visit `https://havennest.ca` — the site should load. (DNS can take up to a few hours.)

---

## Part C — Create the R2 bucket (document storage)

```bash
npm install -g wrangler   # or use npx wrangler
wrangler login            # opens a browser to authorize
wrangler r2 bucket create havennest-applications
```
Then in **Cloudflare dashboard → R2 → havennest-applications → Settings → Object lifecycle rules**,
add a rule to **delete objects after 90 days** (your retention window — see `RETENTION.md`).
Keep the bucket **private** (no public access).

---

## Part D — Enable Email Routing (so applications email you)

1. **Cloudflare → Email → Email Routing** → enable it for havennest.ca (this adds the MX/SPF
   records automatically).
2. **Create/verify a destination address** — the inbox where applications land. Use a
   dedicated, **2FA-protected** mailbox (e.g. forward `applications@havennest.ca` to it, or
   verify your own address as a destination). You'll get a confirmation email to click.
3. Note two addresses for the Worker config:
   - **OWNER_EMAIL** = the **verified destination** (where mail is delivered).
   - **FROM_EMAIL** = any address **on havennest.ca** (e.g. `applications@havennest.ca`).

---

## Part E — Create a Turnstile widget (anti-spam)

1. **Cloudflare → Turnstile → Add widget**. Domain: `havennest.ca` (add `api.havennest.ca` too).
2. Copy the **Site key** → put it in [`src/data/site.ts`](src/data/site.ts) → `turnstileSiteKey`.
3. Copy the **Secret key** → you'll set it as a Worker secret in Part F.

---

## Part F — Deploy the API Worker

1. Edit [`worker/wrangler.toml`](worker/wrangler.toml) `[vars]`:
   - `OWNER_EMAIL` = your verified destination (Part D)
   - `FROM_EMAIL` = an address on havennest.ca
   - confirm `SITE_BASE = "https://havennest.ca"` and `PUBLIC_API_BASE = "https://api.havennest.ca"`
   - set the `[[send_email]]` `destination_address` to the **same** OWNER_EMAIL.
2. Set the secrets (run in the `worker/` folder):
   ```bash
   cd worker
   npm install
   wrangler secret put TURNSTILE_SECRET       # paste the Turnstile secret
   wrangler secret put JWT_SECRET             # a long random string (e.g. `openssl rand -hex 32`)
   wrangler secret put FILE_SIGNING_SECRET    # another long random string
   ```
3. Deploy and bind the subdomain:
   ```bash
   wrangler deploy
   ```
   Then in **Cloudflare → Workers & Pages → havennest-api → Settings → Domains & Routes**,
   add a **Custom Domain**: `api.havennest.ca` (Cloudflare creates the DNS + certificate).
4. **Rate limiting (recommended):** Cloudflare → your domain → **Security → WAF → Rate limiting rules**.
   Add a rule: if URI path starts with `/api/`, more than ~10 requests/min per IP → Block.
5. Quick check:
   ```bash
   curl -i -X OPTIONS -H "Origin: https://havennest.ca" https://api.havennest.ca/api/apply
   # expect: HTTP/2 204 with access-control-allow-origin: https://havennest.ca
   ```

---

## Part G — Admin login (Sveltia CMS via GitHub OAuth)

1. **Register a GitHub OAuth App** (GitHub → Settings → Developer settings → OAuth Apps → New):
   - Homepage URL: `https://havennest.ca`
   - Authorization callback URL: the auth-Worker URL from the next step (e.g.
     `https://havennest-cms-auth.<your-subdomain>.workers.dev/callback`).
   - Save the **Client ID** and **Client Secret**.
2. **Deploy the OAuth proxy Worker** (one-time) from the open-source `sveltia/sveltia-cms-auth`
   project: clone it, set its `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and
   `ALLOWED_DOMAINS=havennest.ca` as secrets, then `wrangler deploy`. Copy its URL.
3. Edit [`public/admin/config.yml`](public/admin/config.yml):
   - `repo: <your-user>/havennest`
   - `base_url: https://<the-auth-worker-url>`
4. Commit + push. Go to `https://havennest.ca/admin`, click **Login with GitHub**. Only
   collaborators on the repo can sign in — that is the access control.
   - *Simplest alternative for a solo owner:* use **Work with Local Repository** on your own
     computer (Chrome) — no OAuth needed — and push the changes git makes.

---

## Part H — Final site configuration

Edit [`src/data/site.ts`](src/data/site.ts) and commit:
- `apiBase` → `https://api.havennest.ca` (already the default)
- `turnstileSiteKey` → your real site key
- `contact.email`, `contact.phone`
- `social.facebook` / `instagram` / `x` / `linkedin` (footer icons appear only when set)

---

## Part I — Verify production end-to-end

1. **Application:** open `https://havennest.ca/apply`, complete it with a test file, submit.
   Confirm you receive the application email at OWNER_EMAIL with a working occupant/consent
   summary, a **proof-of-income** download link, and a **"shortlist upload link"** button.
2. **Shortlist:** click that link → it opens `/documents` → upload a test ID + credit report →
   confirm you get the **"Shortlist documents received"** email with working links.
3. **Download links** open the files and then **expire** after the configured window.
4. **Contact form** sends you a message.
5. **Admin:** log in at `/admin`, edit a unit, **Publish**, and confirm the Action rebuilds and
   the change is live within ~1–2 minutes.

---

## Day-to-day

- **Edit listings:** `/admin` (or edit the markdown in `src/content/properties/` and push).
- **Add new photos:** drop them in `Photographs/`, run `npm run assets`, commit the results.
- **Change branding:** replace `_brand_src/Logo-wo-bg.png`, run `npm run brand`, commit.
- **Retention:** follow `RETENTION.md` — purge old application emails, and the R2 lifecycle
  rule auto-deletes documents after 90 days.

## Costs
Everything here is free-tier: GitHub Pages + Actions, Cloudflare Pages/Workers/R2/Email
Routing/Turnstile, and Sveltia CMS (open source). The only paid item you might add later is a
custom email-sending service (e.g. Resend) if you want to also email applicants confirmations.

## Troubleshooting
- **Form returns 403 `forbidden_origin`:** the browser origin isn't in the Worker's
  `ALLOWED_ORIGINS` — add it in `worker/wrangler.toml` and redeploy.
- **No application email:** check Email Routing destination is **verified**, `FROM_EMAIL` is on
  havennest.ca, and the `[[send_email]]` `destination_address` matches OWNER_EMAIL.
- **Turnstile always fails:** confirm the **site key** in `site.ts` and the **secret** in the
  Worker belong to the same widget, and the widget lists havennest.ca + api.havennest.ca.
- **Admin won't load listings:** check `repo` and `base_url` in `public/admin/config.yml` and
  that the OAuth callback URL matches the auth Worker.
- **Legal:** have an Alberta lawyer review the application questions, screening criteria, and
  consent/privacy text before going live (see `README.md` + `RETENTION.md`).
