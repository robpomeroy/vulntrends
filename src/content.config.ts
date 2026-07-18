/**
 * Content Collections configuration.
 *
 * Defines the `blog` collection: Markdown posts under `src/content/blog/`,
 * each with validated frontmatter. Astro 7 uses the glob loader pattern
 * (imported from `astro/loaders`) rather than the legacy `type: 'content'`
 * directory convention.
 *
 * Posts are rendered at build time via `render()` in the dynamic route
 * `src/pages/blog/[...slug].astro`. No new dependencies are required.
 */

import { defineCollection } from 'astro:content';
import { z } from 'astro:schema';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    /**
    * Optional hero image served from `public/` (recommended: `/images/blog/<file>`).
    * Also accepts a repo-root path like `~/public/images/blog/<file>` which is
    * normalised to a public-rooted URL at render time.
    */
    heroImage: z.string().optional(),
    heroImageAlt: z.string().optional(),
  }),
});

export const collections = { blog };
