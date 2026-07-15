/**
 * Dynamic robots.txt — generated at build time from Astro.site so the
 * sitemap URL matches whatever environment is being deployed.
 *
 *   astro build                    → https://vulntrends.org/sitemap-index.xml
 *   astro build --site https://staging.vulntrends.org → https://staging.vulntrends.org/sitemap-index.xml
 *
 * Astro.site is the value passed to the `site` config option (or
 * `--site` CLI flag), so this stays in sync with `<link rel="canonical">`,
 * `og:url`, and the sitemap integration — all of which read from the
 * same source.
 */

import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const origin = site?.origin ?? 'https://vulntrends.org';
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${origin}/sitemap-index.xml`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};