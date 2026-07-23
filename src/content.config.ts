/**
 * Content Collections configuration.
 *
 * Defines two collections:
 *   - `blog` — Markdown posts under `src/content/blog/`
 *   - `chartExplanations` — long-form explanations rendered into the
 *     click-through chart pages. One entry per chart; the entry id
 *     matches the chart key (e.g. "discovered", "fixed",
 *     "patch-lag", "backlog", "severity-mix").
 *
 * Note on naming: the collection KEY in the `collections` export is
 * `chartExplanations` (camelCase — must be a valid JavaScript
 * identifier, since `getEntry('chartExplanations', ...)` is called
 * from the chart page templates). The on-disk directory uses the
 * natural hyphenated form `src/content/chart-explanations/` for
 * readability. The two are decoupled: Astro's glob loader reads
 * files from the `base` path and indexes them under the
 * collection's export key, so the directory name and the key do
 * not have to match. The glob pattern used here is `*.md` underneath
 * `src/content/chart-explanations/` and likewise contains no
 * collection-name reference.
 *
 * Astro 7 uses the glob loader pattern (imported from `astro/loaders`)
 * rather than the legacy `type: 'content'` directory convention.
 *
 * Posts are rendered at build time via `render()` in the dynamic
 * routes. No new dependencies are required.
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

const chartExplanations = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/chart-explanations' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

export const collections = { blog, chartExplanations };
