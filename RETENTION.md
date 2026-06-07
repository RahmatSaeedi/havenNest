# Data Retention & Destruction Schedule

HavenNest collects sensitive personal information through the rental application
(identity, income, credit report, government ID, references). Under Alberta's
**Personal Information Protection Act (PIPA)** and federal **PIPEDA**, this data
must be kept only as long as reasonably necessary and then securely destroyed.
This document is the written schedule the law expects you to have. Review it with
legal counsel and adjust the windows to your needs.

## Where applicant data lives

| Store | What | Retention | How it's destroyed |
| --- | --- | --- | --- |
| **Cloudflare R2** (`havennest-applications`) | Uploaded documents (proof of income, credit report, photo ID) | **90 days** (recommended) | **Automated** — set an R2 Object Lifecycle rule to delete objects after the window |
| **Owner mailbox** (`OWNER_EMAIL`) | Application summary emails + signed download links | **90 days** for non-selected applicants | **Manual/scheduled** — delete old application emails on a recurring reminder |
| **Signed download links** | Time-limited links inside the emails | **14 days** (`FILE_LINK_TTL_DAYS`) | Expire automatically; after expiry the file is unreachable even if the email remains |
| **GitHub repo** | Listing content only — **no applicant data** | n/a | Applicant data is never written to the repo |

> Applicant data is intentionally **not** stored in a database. It exists only as
> R2 objects (auto-expiring) and emails to the owner — minimizing the footprint.

## Required one-time configuration

1. **R2 lifecycle rule** — In the Cloudflare dashboard → R2 → `havennest-applications`
   → Settings → Object lifecycle rules, add: *delete objects 90 days after creation*.
2. **Owner mailbox hygiene** — Use a dedicated, **2FA-protected** inbox for
   `OWNER_EMAIL`. Put a recurring calendar reminder (e.g. monthly) to delete
   application emails for applicants who were not selected.
3. **Link TTL** — `FILE_LINK_TTL_DAYS` in `worker/wrangler.toml` controls how long
   the document links in each email remain valid (default 14 days).

## Operating rules

- **Successful applicants:** retain only what's needed to administer the tenancy;
  move long-term tenancy records into your normal tenancy file, not the application
  pipeline.
- **Unsuccessful applicants:** delete R2 objects (automatic) and the corresponding
  application email within the retention window.
- **Access:** only the owner/authorized staff may open the documents. Links are
  signed and expiring; the R2 bucket is private and never publicly listed.
- **No SIN** is ever collected. Banking / pre-authorized-debit details are collected
  only **after** approval, in a separate secure step — not through the public form.
- **Breach:** if personal information is lost or accessed improperly, follow PIPA's
  breach-reporting obligations (notify the Office of the Information and Privacy
  Commissioner of Alberta and affected individuals where required).

## Cross-border note

Cloudflare and email infrastructure may process/store data outside Alberta/Canada.
This is disclosed in the public [Privacy Policy](/privacy). Keep that disclosure
accurate if you change providers.

_Last reviewed: June 2026 — update on review._
