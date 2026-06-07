# HavenNest — Builder & Rental Application Website

A fast, high-fidelity static site that markets **HavenNest** as an Edmonton home
builder **and** takes in-depth rental applications for its suites. Built to run
entirely on **free tiers**.

- **Site:** [Astro](https://astro.build) static site → **GitHub Pages** (Cloudflare CDN/DNS in front)
- **Backend:** a standalone **Cloudflare Worker** (`/worker`) — application + contact handling, document uploads to **R2**, owner notifications via **Cloudflare Email Routing**
- **Admin:** **Sveltia CMS** at `/admin` (git-based, GitHub login) to add/edit listings
- **Property:** fourplex at 9911 158 Street NW, Edmonton, AB — 4 main-floor + 4 legal basement suites

## What's included

| Page | Path |
| --- | --- |
| Home (builder + rentals) | `/` |
| Available units (filterable) | `/properties` |
| Listing detail (gallery, specs, apply CTA) | `/properties/<unit>` |
| Builder story (timeline, gallery, walkthrough video) | `/builder` |
| Rental application (8-step wizard, uploads) | `/apply` |
| Contact | `/contact` |
| Privacy policy | `/privacy` |
| Content admin (Sveltia CMS) | `/admin` |

The application captures ~50 vetted, **Alberta-compliant** questions across a jump-anywhere
multi-step wizard: an all-occupants list with friendly Year/Month/Day date selects, DOB +
co-sign capture for adults (with a free-text option for "Other" relationships), multiple
address-history and emergency-contact entries, and **proof of income** upload — with
client-side auto-formatting/validation and full server-side re-validation. To minimize
sensitive-data handling (Alberta OIPC guidance), **government ID and a credit report are
collected only after an applicant is shortlisted**, via a per-applicant secure link
(`/documents`) that the owner forwards from the application email.

## Project structure

```
src/                     Astro site (pages, components, layouts, styles, scripts)
  content/properties/    one markdown file per unit (CMS-edited)
  data/                  site config, application schema, generated photos.json
scripts/                 build + test scripts (photos, brand, e2e, a11y)
public/                  static assets + /admin CMS + generated images/favicons
worker/                  standalone Cloudflare Worker (API backend) — see worker/README.md
Photographs/             source photo originals (gitignored; 365 MB)
_brand_src/              source logo for brand-asset generation
.github/workflows/       GitHub Pages deploy
```

## Local development

```bash
npm install
npm run assets      # generate brand favicons + optimize photos (first run / when photos change)
npm run dev         # http://localhost:4321

# In a second terminal, for the backend:
cd worker && npm install && npm run dev   # http://127.0.0.1:8787
```

> The site posts to `site.apiBase` (default `https://api.havennest.ca`). To exercise
> the live form locally, temporarily point `src/data/site.ts → apiBase` at
> `http://127.0.0.1:8787`, or rely on the test scripts below.

### Asset pipeline (commit the outputs)

- `npm run photos` — optimizes `Photographs/**` → `public/images/properties/**` + `src/data/photos.json`
- `npm run brand` — regenerates favicons, logo marks, OG image from `_brand_src/Logo-wo-bg.png`

Generated web assets are **committed** so CI only runs `astro build` (no `sharp` or
365 MB of originals needed in CI). Re-run `npm run assets` locally and commit when
photos or branding change.

### Tests

```bash
node scripts/e2e-apply.mjs    # browser-drives the wizard end-to-end (API mocked)
node scripts/e2e-worker.mjs   # backend integration test (worker must be running)
node scripts/a11y-check.mjs   # axe-core WCAG audit (preview must be running)
```

These drive the installed Chrome via `playwright-core` — no extra browser download.

## Editing listings (no code)

Listings live as markdown + frontmatter in `src/content/properties/`. The owner
edits them through **Sveltia CMS** at `/admin`:

- **Login with GitHub** (only repo collaborators can authenticate), or **Work with
  Local Repository** for on-device editing in Chrome.
- Each unit has structured fields (rent, beds/baths, sq ft, status, photo set, cover
  index, features), a **rich-text description**, and an optional **custom HTML/CSS
  block** (sanitized on render — scripts/iframes are stripped).
- **Publish** commits to GitHub → GitHub Actions rebuilds → live in ~1–2 minutes.

New gallery photos: drop them in `Photographs/` and run `npm run photos` (the CMS
media manager handles inline images inside descriptions only).

## Deployment & owner setup checklist

> **Full step-by-step production guide: [`DEPLOYMENT.md`](DEPLOYMENT.md).** The checklist
> below is the summary.


**1. GitHub + Pages**
- Push this repo to GitHub. In **Settings → Pages**, set Source = **GitHub Actions**.
- `public/CNAME` is set to `havennest.ca`. The included workflow builds and deploys on every push to `main`.

**2. Cloudflare (DNS / CDN)**
- Add `havennest.ca` to Cloudflare. Point the apex/`www` at GitHub Pages; set SSL/TLS = **Full (strict)** and enable HSTS.

**3. Backend Worker** — see [`worker/README.md`](worker/README.md) for the full steps:
- Create a private R2 bucket `havennest-applications` + a lifecycle rule to auto-delete after your retention window (e.g. 90 days).
- Enable **Email Routing** on `havennest.ca`; verify the owner inbox as a destination; set `FROM_EMAIL`/`OWNER_EMAIL` + the `[[send_email]]` destination.
- Create a **Turnstile** widget; put the site key in `src/data/site.ts` and the secret in the Worker.
- `wrangler secret put TURNSTILE_SECRET / JWT_SECRET / FILE_SIGNING_SECRET`, then `wrangler deploy` and bind `api.havennest.ca`.
- Add a Cloudflare **WAF Rate Limiting Rule** on `/api/*`.

**4. CMS auth (Sveltia)**
- Deploy the `sveltia/sveltia-cms-auth` Worker, register a GitHub OAuth App pointing at it, and set `repo` + `base_url` in `public/admin/config.yml`.

**5. Configure** `src/data/site.ts` — phone, emails, Turnstile site key, and confirm `apiBase`.

## Compliance

The application and privacy copy are drafted to align with Alberta's **Residential
Tenancies Act** (no application fee), the **Alberta Human Rights Act** (source of
income, family status and related grounds are protected — apply criteria uniformly,
no automated income-based rejection), and **PIPA/PIPEDA** (explicit credit/privacy
consent, no SIN collected, secure handling and destruction). See
[`RETENTION.md`](RETENTION.md) for the data retention & destruction schedule.

> **This is not legal advice.** Have an Alberta lawyer review the final application
> questions, screening criteria, and consent/privacy text before launch.

## Tech notes

- Design system in `src/styles/tokens.css` (warm charcoal + warm white + brand gold; WCAG AA verified).
- Galleries: GLightbox (images + the construction video). Masks: IMask. Validation: native Constraint Validation + custom rules; re-validated server-side with Zod.
- Document flow: `apply-begin` (Turnstile → upload JWT) → `upload` (per-file to R2, magic-byte sniffed) → `apply` (Zod + ownership check → owner email with signed, expiring R2 links + a forwardable shortlist-upload link).
- Shortlist flow: owner forwards the link → applicant opens `/documents` → `doc-check` (greeting) → `doc-begin` (Turnstile → scoped upload JWT) → `upload` → `doc-submit` (owner gets a "documents received" email).
