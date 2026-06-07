/**
 * Central site configuration. Edit these values to update contact details,
 * the backend API endpoint, and brand copy across the whole site.
 */
export const site = {
  name: 'HavenNest',
  legalName: 'HavenNest Homes',
  tagline: 'Foundation of Trust, Walls of Comforts',
  shortPitch:
    'Edmonton-built homes, crafted to last — now leasing brand-new suites with premium finishes.',
  url: 'https://havennest.ca',

  // Backend (standalone Cloudflare Worker). Override per-environment if needed.
  // During local dev with `wrangler dev`, point this at http://127.0.0.1:8787.
  apiBase: 'https://api.havennest.ca',

  // Cloudflare Turnstile site key (public). Replace with the real key from the
  // Turnstile dashboard. The matching secret lives only in the Worker.
  turnstileSiteKey: '0x4AAAAAADf9DjlVzyg3ovxf', // Cloudflare test key — replace before launch

  contact: {
    // Public-facing inbox. Applications are emailed to applications@havennest.ca
    // (configured in Cloudflare Email Routing), general enquiries to info@.
    email: 'info@havennest.ca',
    applicationsEmail: 'applications@havennest.ca',
    phone: '', // TODO(owner): add a public phone number, or leave blank to hide
  },

  property: {
    name: '9911 — 158 Street NW',
    addressLine: '9911 158 Street NW',
    city: 'Edmonton',
    province: 'AB',
    provinceLong: 'Alberta',
    country: 'Canada',
    postal: 'T5P2X6', // TODO(owner): add postal code
    // Used for the static map link/embed.
    mapsQuery: '9911 158 Street NW, Edmonton, AB',
  },

  // Social profile links shown in the footer. Leave blank to hide an icon.
  social: {
    // TODO(owner): add real profile URLs (e.g. https://facebook.com/havennest)
    facebook: '',
    instagram: '',
    x: '',
    linkedin: '',
  },

  // Primary navigation (Apply is rendered as a CTA button separately).
  nav: [
    { label: 'Home', href: '/' },
    { label: 'Available Units', href: '/properties' },
    { label: 'Our Builds', href: '/builder' },
    { label: 'Contact', href: '/contact' },
  ],

  copyrightStartYear: 2024,
};

export type Site = typeof site;
