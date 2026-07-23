/**
 * Content Collections configuration.
 *
 * Defines two collections:
 *   - `blog` — Markdown posts under `src/content/blog/`
 *   - `chartExplanations` — long-form explanations rendered into the
 *     four `src/pages/charts/*.astro` click-through pages. One entry per
 *     chart; the entry id matches the chart key (e.g. "discovered",
 *     "fixed", "patch-lag", "backlog").
 *
 * The chart-explanations collection is configured with a single
 * directory and uses an underscore in the directory name. The
 * underscore avoids an Astro 7 issue where glob-loaded collections
 * with hyphenated directory names silently fail to populate on
 * Windows. If/when that upstream issue is fixed, the directory can
 * be renamed back to `chart-explanations` for consistency.
 *
 * Astro 7 uses the glob loader pattern (imported from `astro/loaders`)
 * rather than the legacy `type: 'content'` directory convention.
 *
 * Posts are rendered at build time via `render()` in the dynamic routes.
 * No new dependencies are required.
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
