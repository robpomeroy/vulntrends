/**
 * End-to-end publish script — runs on the Synology NAS as a scheduled task.
 *
 * Steps:
 *   1. npm run data:build   (fetch all sources, normalise, aggregate)
 *   2. npm run data:validate (Zod schema check)
 *   3. npm run build         (Astro static build → dist/)
 *   4. rsync dist/ → web host (production or staging)
 *
 * Flags:
 *   --staging   Deploy to the staging path instead of production
 *   --dry-run   Do everything except the rsync (useful for testing the
 *               pipeline without deploying)
 *
 * Reads DEPLOY_* variables from .env (loaded automatically by the
 * `--env-file-if-exists=.env` flag in the npm script). On any step
 * failure the script prints to stderr and exits non-zero so the
 * Synology Task Scheduler emails the result.
 *
 * Usage:
 *   npm run publish                  # production
 *   npm run publish:staging          # staging
 *   npm run publish:dry-run          # production, no rsync
 *   npm run publish:staging:dry-run  # staging, no rsync
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// ── Flags ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const staging = args.includes('--staging');
const dryRun = args.includes('--dry-run');

// ── Config ─────────────────────────────────────────────────────────

const DEPLOY_HOST = process.env.DEPLOY_HOST;
const DEPLOY_PORT = process.env.DEPLOY_PORT || '22';
const DEPLOY_USER = process.env.DEPLOY_USER;
const DEPLOY_KEY = process.env.DEPLOY_KEY;
const DEPLOY_PROD_PATH = process.env.DEPLOY_PROD_PATH;
const DEPLOY_STAGING_PATH = process.env.DEPLOY_STAGING_PATH;

// SITE_URL overrides the `site` config in astro.config.mjs at build
// time. Production defaults to vulntrends.org; the staging deploy
// passes --staging and gets staging.vulntrends.org. This is what
// makes robots.txt, sitemap-index.xml, og:url, og:image, and <link
// rel="canonical"> all match the environment being deployed.
const SITE_URL_PROD = process.env.SITE_URL || 'https://vulntrends.org';
const SITE_URL_STAGING = process.env.SITE_URL_STAGING || 'https://staging.vulntrends.org';

const targetPath = staging
  ? DEPLOY_STAGING_PATH
  : DEPLOY_PROD_PATH;

const targetLabel = staging ? 'staging' : 'production';

const siteUrl = staging ? SITE_URL_STAGING : SITE_URL_PROD;

// Validate the chosen site URL before any work begins. A mistyped SITE_URL
// (missing scheme, malformed host) would otherwise sail
// through every step and only surface as broken canonical/og/sitemap
// URLs in the deployed site — or worse, a confusing build failure
// late in the pipeline. Fail fast with a clear message instead.
// `URL` rejects missing-scheme and malformed input; the explicit
// protocol check rejects accidental http:// or relative paths that
// the constructor would otherwise accept.
function validateSiteUrl(label: string, value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    console.error(`✗ Invalid SITE_URL for ${label}: ${JSON.stringify(value)}`);
    console.error('  Expected an absolute URL like https://vulntrends.org');
    process.exit(1);
  }
  if (parsed.protocol !== 'https:') {
    console.error(`✗ SITE_URL for ${label} must use https:// — got ${parsed.protocol}`);
    console.error(`  Value: ${value}`);
    process.exit(1);
  }
}

validateSiteUrl(targetLabel, siteUrl);

// ── Helpers ───────────────────────────────────────────────────────

const REPO_ROOT = resolve(process.cwd());

function runStep(label: string, command: string, args: string[]): void {
  const start = Date.now();
  console.log(`\n── ${label} ──────────────────────────────────────`);
  console.log(`$ ${command} ${args.join(' ')}`);

  try {
    execFileSync(command, args, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      timeout: 30 * 60 * 1000, // 30 min hard cap per step
      encoding: 'utf-8',
      shell: process.platform === 'win32', // npm.cmd on Windows
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✓ ${label} completed in ${elapsed}s`);
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`✗ ${label} FAILED after ${elapsed}s`);
    console.error(err);
    process.exit(1);
  }
}

function validateConfig(): void {
  const missing: string[] = [];
  if (!DEPLOY_HOST) missing.push('DEPLOY_HOST');
  if (!DEPLOY_USER) missing.push('DEPLOY_USER');
  if (!DEPLOY_KEY) missing.push('DEPLOY_KEY');
  if (!targetPath) missing.push(staging ? 'DEPLOY_STAGING_PATH' : 'DEPLOY_PROD_PATH');

  if (missing.length > 0 && !dryRun) {
    // In dry-run mode we skip rsync, so deploy vars aren't needed.
    // But we still warn if they're missing so the user knows.
    console.error('Missing required .env variables for deployment:');
    for (const v of missing) console.error(`  ${v}`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }

  if (missing.length > 0 && dryRun) {
    console.warn('Warning: deploy variables not set (dry-run mode — rsync will be skipped):');
    for (const v of missing) console.warn(`  ${v}`);
  }
}

function rsync(): void {
  if (dryRun) {
    console.log('\n── rsync (skipped — dry-run) ────────────────────');
    const dest = DEPLOY_USER && DEPLOY_HOST && targetPath ? `${DEPLOY_USER}@${DEPLOY_HOST}:${targetPath}` : '<missing DEPLOY_* variables>';
    console.log(`Would rsync dist/ → ${dest}`);
    return;
  }

  console.log(`\n── rsync → ${targetLabel} ───────────────────────────`);
  console.log(`  host: ${DEPLOY_HOST}:${DEPLOY_PORT}`);
  console.log(`  user: ${DEPLOY_USER}`);
  console.log(`  path: ${targetPath}`);

  // The SSH command must be a single argv element so rsync passes
  // it intact to /bin/sh -c on the remote end. Each option here is
  // space-separated inside ONE string.
  const sshCmd = `ssh -p ${DEPLOY_PORT} -i "${DEPLOY_KEY}" -o StrictHostKeyChecking=accept-new`;

  // Synology DSM creates @eaDir directories (extended-attribute
  // indexes for the FileStation / media indexer) inside every
  // directory it touches. We never want them synced to production
  // (they contain thumbnails and metadata, not content). Add more
  // excludes here as needed.
  const excludes = ['@eaDir/'];

  // Force a known permission set on the destination regardless of
  // what the local files have. 'a' (archive) preserves permissions
  // by default, but the local perms depend on whoever ran
  // `npm run build` (your user on the NAS, often root/Administrator
  // elsewhere), which is rarely what the web host wants. The web
  // host needs 0755 on directories and 0644 on files — D755,F644
  // is the canonical rsync idiom for that.
  const chmod = 'D755,F644';

  // For the log line, wrap the SSH command in single quotes so the
  // reader can see it's one argument. The actual execFileSync call
  // passes each element as a separate argv token regardless, so no
  // shell-level escaping is needed.
  console.log(
    `$ rsync -avz --delete --chmod='${chmod}' ` +
      excludes.map((e) => `--exclude='${e}' `).join('') +
      `-e '${sshCmd}' dist/ ` +
      `${DEPLOY_USER}@${DEPLOY_HOST}:${targetPath}`,
  );

  // Build the argv array. Order matters: exclude flags first, then
  // -e with the SSH command as a single element, then source + dest.
  const rsyncArgs: string[] = [
    '-avz',
    '--delete',
    '--chmod',
    chmod,
    ...excludes.flatMap((e) => ['--exclude', e]),
    '-e',
    sshCmd,
    'dist/',
    `${DEPLOY_USER}@${DEPLOY_HOST}:${targetPath}`,
  ];

  try {
    // NB: no `shell: true` here. rsync is a real binary; passing
    // argv directly is correct on both Windows and Linux and avoids
    // any shell metacharacter issues with the SSH command.
    execFileSync('rsync', rsyncArgs, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      timeout: 10 * 60 * 1000, // 10 min cap for rsync
    });
    console.log('✓ rsync completed');
  } catch (err) {
    console.error('✗ rsync FAILED');
    console.error(err);
    process.exit(1);
  }
}

// ── Main ───────────────────────────────────────────────────────────

function main(): void {
  const start = Date.now();
  const mode = [
    targetLabel,
    dryRun ? 'dry-run' : null,
  ].filter(Boolean).join(' / ');

  console.log('══════════════════════════════════════════════════════');
  console.log(`  VulnTrends publish — ${mode}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  site:  ${siteUrl}`);
  console.log('══════════════════════════════════════════════════════');

  validateConfig();

  // Step 1: Refresh data
  runStep('data:build', 'npm', ['run', 'data:build']);

  // Step 2: Validate
  runStep('data:validate', 'npm', ['run', 'data:validate']);

  // Step 3: Build site — invoke through `npm run build` (the
  // canonical entry point) and forward `--site` to the underlying
  // `astro build` via npm's `--` separator. This keeps publish on
  // the same script local builds use, so if the build script ever
  // gains flags or preflight checks (cf. check-platform.mjs on the
  // other scripts), publish inherits them automatically. `--site`
  // makes Astro.site reflect the target environment, which drives
  // sitemap URLs, robots.txt, og:url, og:image, and the canonical
  // link in every page.
  runStep('build', 'npm', ['run', 'build', '--', '--site', siteUrl]);

  // Step 4: Deploy
  rsync();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  ✓ Publish complete — ${mode} — ${elapsed}s`);
  console.log('══════════════════════════════════════════════════════\n');
}

main();
