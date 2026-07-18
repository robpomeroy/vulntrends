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
         * Optional hero image. Resolved at build time as a `?url` import
         * (e.g. `import hero from '../../public/images/blog/foo.jpg?url'`)
         * so the existing `base` config is respected without hard-coding
         * a path. Omit for posts without a hero image.
         */
        heroImage: z.string().optional(),
        heroImageAlt: z.string().optional(),
      }),
});

export const collections = { blog };
