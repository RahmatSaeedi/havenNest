import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Rental unit listings. Edited by the owner through the CMS (/admin), stored as
 * markdown + frontmatter so every change is versioned in git and triggers a
 * rebuild. The markdown body is the rich-text description; `customHtml` is the
 * optional raw HTML/CSS block (sanitized at render time).
 */
const properties = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/properties' }),
  schema: z.object({
    title: z.string(),
    unitType: z.enum(['main', 'basement']),
    unitLabel: z.string().optional(), // e.g. "Main-floor Unit 1"
    status: z.enum(['available', 'pending', 'rented']).default('available'),
    beds: z.number(),
    baths: z.number(),
    sqft: z.number(),
    rent: z.number(),
    garagePrice: z.number().default(125),
    garageAvailable: z.boolean().default(true),
    utilitiesNote: z.string().default('Tenant pays utilities'),
    depositNote: z
      .string()
      .default('Security deposit equal to one month’s rent at lease signing. No application fee.'),
    features: z.array(z.string()).default([]),
    appliances: z.array(z.string()).default([]),
    // Which shared photo set to use for this unit's gallery, and which image in
    // that set to use as the card cover (so similar units don't look identical).
    gallery: z.enum(['main', 'basement', 'exterior']).default('main'),
    coverIndex: z.number().default(0),
    availableFrom: z.string().default('Available now'),
    summary: z.string().optional(),
    order: z.number().default(0),
    // Optional raw HTML/CSS injected into the listing page (sanitized on render).
    customHtml: z.string().optional(),
  }),
});

export const collections = { properties };
