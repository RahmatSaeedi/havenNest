// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// HavenNest is served from the apex domain (custom domain on GitHub Pages),
// so the base path is '/'. If you ever deploy to a project page
// (e.g. user.github.io/havennest), set `base: '/havennest'`.
export default defineConfig({
  site: 'https://havennest.ca',
  trailingSlash: 'ignore',
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/admin'),
    }),
  ],
  // We pre-optimize photos into /public via `npm run photos`, so we don't lean
  // on Astro's built-in image service for the galleries.
  build: {
    inlineStylesheets: 'auto',
  },
});
