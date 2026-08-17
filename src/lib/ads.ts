/**
 * Shared helper for AdSense ad integration.
 *
 * Mirrors the existing Plausible conditional-loading pattern in
 * `src/layouts/Dashboard.astro` (and now `ChartPage.astro`): three
 * guards must all pass before ads are served:
 *
 *   1. `PUBLIC_ADSENSE_ENABLED === 'true'` — explicit opt-in via .env.
 *   2. `!isStaging` — `Astro.site.hostname` is set per-environment by
 *      `npm run publish` / `npm run publish:staging` via the `--site`
 *      flag to `astro build`. Any `staging.*` hostname is auto-excluded
 *      regardless of the boolean, so staging deploys never serve ads.
 *   3. `!!adsenseClient` — the `ca-pub-XXXXXXXXXXXXXXXX` ID is set.
 *      Prevents a broken `<script src="">` if the boolean is on but
 *      the ID is missing.
 *
 * The PUBLIC_ prefix is required: Astro/Vite only exposes env vars
 * beginning with PUBLIC_ (or VITE_) to .astro frontmatter via
 * import.meta.env. Vite loads .env automatically during `astro build`,
 * so no --env-file flag is needed.
 *
 * This helper exists to avoid duplicating the three guards and the
 * ASTRO_SITE hostname check across both layouts. If you need to add
 * a third layout (e.g. a print-friendly page), import this rather
 * than copy-pasting the logic.
 */

export interface AdsConfig {
  /** Whether ads should be served on this page. */
  enabled: boolean;
  /** The AdSense client ID (ca-pub-XXXXXXXXXXXXXXXX), or empty. */
  client: string;
}

/**
 * Read the AdSense configuration for the current build.
 *
 * Pass `Astro.site` directly — this function checks the hostname
 * for the staging exclude rule. The boolean + client ID come
 * from Vite-baked env vars at build time.
 */
export function getAdsConfig(site: URL | undefined): AdsConfig {
  const client = import.meta.env.PUBLIC_ADSENSE_CLIENT?.trim() ?? '';
  const explicitlyEnabled =
    import.meta.env.PUBLIC_ADSENSE_ENABLED === 'true';
  const isStaging = site?.hostname.startsWith('staging.') ?? false;
  return {
    enabled: explicitlyEnabled && !isStaging && client.length > 0,
    client,
  };
}
