/**
 * Shared helper for Plausible Analytics integration.
 *
 * Mirrors the AdSense pattern in `src/lib/ads.ts` (and follows its
 * three-guard convention exactly), so the guards are defined in one
 * place rather than duplicated across every layout that renders the
 * tracker.
 *
 *   1. `PUBLIC_PLAUSIBLE_ENABLED === 'true'` — explicit opt-in via .env.
 *   2. `!isStaging` — `Astro.site.hostname` is set per-environment by
 *      `npm run publish` / `npm run publish:staging` via the `--site`
 *      flag to `astro build`. Any `staging.*` hostname is auto-excluded
 *      regardless of the boolean, so staging deploys never serve the
 *      tracker even if the boolean is left on in a shared .env.
 *   3. `!!scriptUrl` — the per-site script URL is set. Prevents a
 *      broken `<script src="">` if the boolean is on but the URL is
 *      forgotten.
 *
 * The PUBLIC_ prefix is required: Astro/Vite only exposes env vars
 * beginning with PUBLIC_ (or VITE_) to .astro frontmatter via
 * import.meta.env. Vite loads .env automatically during `astro build`,
 * so no --env-file flag is needed.
 *
 * ## Why there is no data-domain option
 *
 * The tracker URL is Plausible's *per-site* script
 * (`https://<instance>/js/pa-<id>.js`). That script has the reporting
 * domain and the event endpoint baked in — it does not read a
 * `data-domain` or `data-api` attribute at all. The domain is
 * therefore configured in the Plausible instance, not in this repo,
 * which is why there is no `PUBLIC_PLAUSIBLE_DATA_DOMAIN` variable.
 *
 * Note that the per-site script also *ignores* a `domain` passed to
 * `plausible.init({domain: ...})`: it assigns its own domain last, so
 * a caller-supplied value is silently overridden. The only supported
 * way to change the domain is to change the per-site script URL.
 *
 * This helper exists to avoid duplicating the three guards and the
 * Astro.site hostname check across layouts. If you add a third layout
 * that should be tracked, import this rather than copy-pasting the
 * logic.
 */

export interface PlausibleConfig {
  /** Whether the Plausible tracker should be emitted on this page. */
  enabled: boolean;
  /** The per-site tracker script URL, or empty when unconfigured. */
  scriptUrl: string;
}

/**
 * Read the Plausible configuration for the current build.
 *
 * Pass `Astro.site` directly — this function checks the hostname
 * for the staging exclude rule. The boolean + script URL come
 * from Vite-baked env vars at build time.
 */
export function getPlausibleConfig(site: URL | undefined): PlausibleConfig {
  const scriptUrl = import.meta.env.PUBLIC_PLAUSIBLE_SCRIPT_URL?.trim() ?? '';
  const explicitlyEnabled = import.meta.env.PUBLIC_PLAUSIBLE_ENABLED === 'true';
  const isStaging = site?.hostname.startsWith('staging.') ?? false;
  return {
    enabled: explicitlyEnabled && !isStaging && scriptUrl.length > 0,
    scriptUrl,
  };
}
