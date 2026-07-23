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
 *   --staging              Deploy to the staging path instead of production
 *   --dry-run              Do everything except the rsync (useful for testing
 *                          the pipeline without deploying)
 *   --only=<stages>        Run only the named comma-separated stages (executed
 *                          in canonical order according to `STAGES`).
//                          Stages: data:build, data:validate, data:audit, data:archive, data:csv, build, rsync.
 *                          Example: --only=rsync  (re-run only the rsync step)
 *   --skip=<stages>        Run every stage EXCEPT the named ones.
 *                          Example: --skip=data:build  (deploy the existing
 *                          dist/ without re-fetching data)
 *
 *   --only and --skip are mutually exclusive. Passing both, or an unknown
 *   stage name, exits 1 with a usage hint.
 *
 * Reads DEPLOY_* variables from .env (loaded automatically by the
 * `--env-file-if-exists=.env` flag in the npm script). On any step
 * failure the script prints to stderr and exits non-zero so the
 * Synology Task Scheduler emails the result.
 *
 * Usage:
 *   npm run publish                  # full pipeline, production
 *   npm run publish:staging          # full pipeline, staging
 *   npm run publish:dry-run          # full pipeline, production, no rsync
 *   npm run publish:staging:dry-run  # full pipeline, staging, no rsync
 *
 *   # Per-stage (delegates through this script with --only):
 *   npm run publish:data             # fetch + aggregate only
 *   npm run publish:validate         # Zod schema check only
 *   npm run publish:build            # data + validate + build, no deploy
 *   npm run publish:upload           # rsync existing dist/ only
 *   npm run publish:upload:dry-run   # show what rsync would do
 *   npm run publish:skip-data        # deploy existing dist/ without refetching
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Flags ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const staging = args.includes('--staging');
const dryRun = args.includes('--dry-run');

// Stages, in canonical execution order. Reused by --only/--skip
// validation and by `main()` to gate each step.
const STAGES = ['data:build', 'data:validate', 'data:audit', 'data:archive', 'data:csv', 'build', 'rsync'] as const;
type Stage = (typeof STAGES)[number];

function parseStageList(raw: string): Stage[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as Stage[];
}

function findArg(prefix: string): string | undefined {
  // Walk argv manually so `--only=foo` returns `'foo'` and a
  // space-separated `--only foo` (in case anyone passes it that
  // way) works too.
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === prefix) {
      // If the flag is present but the value is missing, return an
      // empty string so validation fails loudly instead of silently
      // falling back to running every stage.
      return args[i + 1] ?? '';
    }
    if (a.startsWith(`${prefix}=`)) return a.slice(prefix.length + 1);
  }
  return undefined;
}

const onlyRaw = findArg('--only');
const skipRaw = findArg('--skip');
// Use `!== undefined` rather than truthiness: `--only=` parses to
// `''`, which is falsy and would otherwise be treated as "no flag"
// and silently fall through to running every stage.
const onlyStages = onlyRaw !== undefined ? parseStageList(onlyRaw) : undefined;
const skipStages = skipRaw !== undefined ? parseStageList(skipRaw) : undefined;

// ── Flag validation ───────────────────────────────────────────────

if (onlyStages && skipStages) {
  console.error('✗ --only and --skip are mutually exclusive.');
  console.error(`  --only=${onlyRaw}`);
  console.error(`  --skip=${skipRaw}`);
  console.error('  Pick one.');
  process.exit(1);
}

const knownStages = new Set<string>(STAGES);
for (const flag of ['--only', '--skip'] as const) {
  const list = flag === '--only' ? onlyStages : skipStages;
  if (!list) continue;
  const bad = list.filter((s) => !knownStages.has(s));
  if (bad.length > 0) {
    console.error(`✗ Unknown ${flag} stage(s): ${bad.join(', ')}`);
    console.error(`  Valid stages: ${[...STAGES].join(', ')}`);
    process.exit(1);
  }
}

if (onlyStages && onlyStages.length === 0) {
  console.error('✗ --only= must include at least one stage.');
  console.error(`  Valid stages: ${[...STAGES].join(', ')}`);
  process.exit(1);
}

if (skipStages && skipStages.length === 0) {
  console.error('✗ --skip= must include at least one stage.');
  console.error(`  Valid stages: ${[...STAGES].join(', ')}`);
  process.exit(1);
}

// Resolve the active stage set. Default (no flags) = all stages,
// preserving the original behaviour exactly.
const activeStages: Stage[] = onlyStages
  ? STAGES.filter((s) => onlyStages.includes(s))
  : skipStages
    ? STAGES.filter((s) => !skipStages.includes(s))
    : [...STAGES];

// Warn loudly when data:build is skipped — the deployed dist/ will
// reflect the previously-built data, not fresh data. The Synology
// Task Scheduler emails stderr, so this is visible in the digest.
if (skipStages?.includes('data:build')) {
  console.error('⚠ --skip=data:build: deploying the previously-built dist/ without fetching fresh data.');
}

// ── Config ─────────────────────────────────────────────────────────

const DEPLOY_HOST = process.env.DEPLOY_HOST;
const DEPLOY_PORT = process.env.DEPLOY_PORT || '22';
const DEPLOY_USER = process.env.DEPLOY_USER;
const DEPLOY_KEY = process.env.DEPLOY_KEY;
const DEPLOY_PROD_PATH = process.env.DEPLOY_PROD_PATH;
const DEPLOY_STAGING_PATH = process.env.DEPLOY_STAGING_PATH;

// Optional Tier-2 archive replication target. If set, after the
// local `data:archive` + `data:prune` steps, the data-archive/
// directory is rsynced here so a backup copy lives off-host. See
// .env.example for the supported forms (SSH `user@host:/path` or
// local `/path`) and the auto-detect heuristic. If unset, a warning
// is logged and the publish continues — the local snapshot is still
// written as a staging area and can be rsynced manually.
const ARCHIVE_RSYNC_TARGET = process.env.ARCHIVE_RSYNC_TARGET || '';

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

  // Refuse to rsync if there's no dist/. --delete would otherwise
  // wipe the entire web root on the remote. Catches the
  // `--only=rsync` before any build was done mistake.
  if (!existsSync(resolve(REPO_ROOT, 'dist'))) {
    console.error('✗ --only=rsync refused: dist/ does not exist.');
    console.error('  Run `npm run publish:build` first or omit --only.');
    process.exit(1);
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

/**
 * Detect whether an ARCHIVE_RSYNC_TARGET is the SSH form
 * (`user@host:/path`) or the local form (`/path`).
 *
 * The distinguishing feature of the SSH form is the `user@host:`
 * prefix — there must be an `@` *before* the first `:`. A Windows
 * drive-letter path like `C:\path\to\archive` has a `:` at position
 * 1 but no `@` before it, and a POSIX local path like
 * `/srv/archive` has no `:` at all. Only the SSH form has both an
 * `@` and a `:`.
 *
 * Returns `true` for SSH, `false` for local.
 */
function isArchiveTargetSsh(target: string): boolean {
  const atSign = target.indexOf('@');
  const firstColon = target.indexOf(':');
  // SSH form: an @ exists, a : exists, and the @ precedes the :.
  // Any other shape (no :, or no @, or : before @) → local path.
  if (atSign === -1 || firstColon === -1) return false;
  return atSign < firstColon;
}

/**
 * Rsync the local `data-archive/` directory to `ARCHIVE_RSYNC_TARGET`
 * (or skip with a warning if the target is unset).
 *
 * Mirrors the web-deploy `rsync()` function's patterns:
 *   - Reuses `DEPLOY_KEY` + `DEPLOY_PORT` for the SSH connection
 *     (the Synology already has the key configured for the web
 *     deploy; no separate archive credential is needed unless the
 *     archive host trusts a different key).
 *   - Uses the same `--chmod=D755,F644` and `--exclude=@eaDir/`
 *     conventions so Synology-isms don't leak.
 *   - Uses `--delete` so the target mirrors the *pruned* local
 *     state. (We prune locally first, then replicate — see the
 *     `data:archive` stage block in `main()` for the ordering.)
 *   - In dry-run mode, adds `--dry-run` to rsync and logs the
 *     command without transferring.
 *
 * Failure here is logged to stderr but does NOT abort the publish.
 * The archive is a backup concern; if replication fails, the web
 * deploy should still proceed so users see fresh data. The stderr
 * message is visible in the Synology Task Scheduler email digest.
 */
function replicateArchive(): void {
  if (!ARCHIVE_RSYNC_TARGET) {
    console.warn('\n── archive replication: SKIPPED ──────────────────');
    console.warn('  ARCHIVE_RSYNC_TARGET is not set in .env.');
    console.warn('  The local data-archive/ snapshot was still written;');
    console.warn('  rsync it manually if a backup copy is needed.');
    return;
  }

  // Refuse to replicate if the local data-archive/ doesn't exist.
  // The data:archive sub-step would have created it; this catches
  // the `--only=rsync` with stale state case.
  const archiveDir = resolve(REPO_ROOT, 'data-archive');
  if (!existsSync(archiveDir)) {
    console.error('✗ archive replication refused: data-archive/ does not exist.');
    console.error('  Run `npm run data:archive` first or omit --only.');
    // Not fatal — same reasoning as the rsync failure path below.
    return;
  }

  const sshForm = isArchiveTargetSsh(ARCHIVE_RSYNC_TARGET);

  // If the SSH form was selected but DEPLOY_KEY is unset, we can't
  // build a -e ssh ... command — falling back to default ssh would
  // result in a confusing "permission denied" on the remote. Fail
  // loud and early with an actionable hint. In dry-run mode we
  // allow it (matches the web deploy's behaviour: deploy vars are
  // not required for dry-run).
  if (sshForm && !DEPLOY_KEY && !dryRun) {
    console.error('✗ archive replication: ARCHIVE_RSYNC_TARGET uses SSH');
    console.error(`  (${ARCHIVE_RSYNC_TARGET}) but DEPLOY_KEY is not set.`);
    console.error('  The SSH form reuses DEPLOY_KEY for the rsync -e option.');
    console.error('  Either set DEPLOY_KEY, switch to a local-path target,');
    console.error('  or unset ARCHIVE_RSYNC_TARGET to disable replication.');
    return;
  }

  console.log('\n── archive replication ──────────────────────────');
  console.log(`  target: ${ARCHIVE_RSYNC_TARGET}`);
  // In dry-run mode DEPLOY_KEY may be unset, so the SSH form may not
  // actually have a key to use. Surface that honestly in the log.
  console.log(
    `  mode:   ${
      sshForm
        ? DEPLOY_KEY
          ? 'SSH rsync (reusing DEPLOY_KEY)'
          : 'SSH rsync (dry-run, DEPLOY_KEY not set)'
        : 'local rsync'
    }`,
  );

  // Synology creates @eaDir directories inside any directory it
  // touches (media-indexer cache). Same convention as the web
  // deploy — keeps them out of the backup.
  const excludes = ['@eaDir/'];
  // Force a known permission set on the target regardless of
  // what the local files have. Same D755/F644 as the web deploy
  // so behaviour is predictable.
  const chmod = 'D755,F644';

  // Build the SSH command string. We reuse DEPLOY_KEY and
  // DEPLOY_PORT (the Synology already has the key on disk and
  // trusts the host) rather than introducing separate
  // ARCHIVE_SSH_* env vars. If a future user needs a different
  // key for the archive host, the right move is to add those
  // vars — but that's deferred per the plan.
  const sshCmd = DEPLOY_KEY
    ? `ssh -p ${DEPLOY_PORT} -i "${DEPLOY_KEY}" -o StrictHostKeyChecking=accept-new`
    : null;

  // argv array passed to execFileSync — no shell, so each option
  // is a separate element. Order: flags first, then -e for SSH
  // (or omitted for local), then source + dest.
  const rsyncArgs: string[] = [
    '-avz',
    '--delete',
    '--chmod',
    chmod,
    ...excludes.flatMap((e) => ['--exclude', e]),
  ];
  if (dryRun) rsyncArgs.push('--dry-run');
  if (sshForm && sshCmd) {
    rsyncArgs.push('-e', sshCmd);
  }
  rsyncArgs.push(
    'data-archive/', // trailing slash = contents of, not the dir itself
    sshForm ? `${ARCHIVE_RSYNC_TARGET}/` : `${ARCHIVE_RSYNC_TARGET}/`,
  );

  // For the log line, mirror the rsync() function's style: wrap
  // the SSH command in single quotes so the reader can see it's
  // one argument. The execFileSync call passes each element as
  // a separate argv token regardless, so no shell-level escaping
  // is needed.
  const sshLog = sshCmd ? `-e '${sshCmd}' ` : '';
  const dryRunLog = dryRun ? '--dry-run ' : '';
  console.log(
    `$ rsync -avz --delete --chmod='${chmod}' ` +
      excludes.map((e) => `--exclude='${e}' `).join('') +
      `${dryRunLog}${sshLog}data-archive/ ${ARCHIVE_RSYNC_TARGET}/`,
  );

  try {
    execFileSync('rsync', rsyncArgs, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      timeout: 10 * 60 * 1000, // 10 min cap
    });
    console.log('✓ archive replication completed');
  } catch (err) {
    // Non-fatal: the archive is a backup concern, not a deployment
    // blocker. Surface the error loudly to stderr (so it shows in
    // the Synology Task Scheduler email digest) but let the web
    // deploy continue.
    console.error('✗ archive replication FAILED (continuing publish)');
    console.error(err);
  }
}

// ── Main ───────────────────────────────────────────────────────────

function main(): void {
  const start = Date.now();
  const stagesLabel = onlyStages
    ? `only=${activeStages.join(',')}`
    : skipStages
      ? `skip=${skipStages.join(',')}`
      : null;
  const mode = [targetLabel, dryRun ? 'dry-run' : null, stagesLabel].filter(Boolean).join(' / ');

  console.log('══════════════════════════════════════════════════════');
  console.log(`  VulnTrends publish — ${mode}`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`  site:  ${siteUrl}`);
  console.log('══════════════════════════════════════════════════════');

  if (activeStages.includes('rsync')) {
    validateConfig();
  }

  // Each step is gated on the active stage list. Default (no
  // --only/--skip) = all stages, preserving the original behaviour.

  // Step 1: Refresh data
  if (activeStages.includes('data:build')) {
    runStep('data:build', 'npm', ['run', 'data:build']);
  }

  // Step 2: Validate
  if (activeStages.includes('data:validate')) {
    runStep('data:validate', 'npm', ['run', 'data:validate']);
  }

  // Step 2.4: Semantic data audit (E5). Emits warnings (not errors) for
  // data quality issues like CVE-year mismatches, future dates, YoY
  // outliers, and per-manufacturer patch-date coverage gaps. Runs
  // after validate so the Zod-shape check has already confirmed the
  // file structure.
  if (activeStages.includes('data:audit')) {
    runStep('data:audit', 'npm', ['run', 'data:audit']);
  }

  // Step 2.5: Archive snapshot (Tier-2 retention). Runs after validate
  // so we only archive known-good data. See scripts/archive-snapshot.ts.
  if (activeStages.includes('data:archive')) {
    runStep('data:archive', 'npm', ['run', 'data:archive']);

    // Sub-step: prune old local snapshots BEFORE the rsync, so the
    // rsync's --delete flag mirrors the pruned state to the target.
    // Without this ordering, the target would grow unbounded and the
    // local prune would have no effect on the remote copy.
    runStep('data:prune', 'npm', ['run', 'data:prune']);

    // Sub-step: rsync the local data-archive/ to ARCHIVE_RSYNC_TARGET
    // (if configured). Wrapped in its own try/guard by replicateArchive
    // so a replication failure does not block the web deploy that
    // follows — the archive is a backup concern, not a deploy blocker.
    replicateArchive();
  }

  // Step 2.6: Export CSVs for click-through downloads. The CSV files
  // must exist before `astro build` so they're included in dist/.
  if (activeStages.includes('data:csv')) {
    runStep('data:csv', 'npm', ['run', 'data:csv']);
  }

  // Step 3: Build site — invoke through `npm run build` (the
  // canonical entry point) and forward `--site` to the underlying
  // `astro build` via npm's `--` separator. This keeps publish on
  // the same script local builds use, so if the build script ever
  // gains flags or preflight checks (cf. check-platform.mjs on the
  // other scripts), publish inherits them automatically. `--site`
  // makes Astro.site reflect the target environment, which drives
  // sitemap URLs, robots.txt, og:url, og:image, and the canonical
  // link in every page.
  if (activeStages.includes('build')) {
    runStep('build', 'npm', ['run', 'build', '--', '--site', siteUrl]);
  }

  // Step 4: Deploy
  if (activeStages.includes('rsync')) {
    rsync();
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  ✓ Publish complete — ${mode} — ${elapsed}s`);
  console.log('══════════════════════════════════════════════════════\n');
}

main();
