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
import { existsSync, readdirSync } from 'node:fs';
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

const targetPath = staging
  ? DEPLOY_STAGING_PATH
  : DEPLOY_PROD_PATH;

const targetLabel = staging ? 'staging' : 'production';

// Map from Node's process.platform / process.arch to npm's os/cpu naming.
const NPM_OS_MAP: Record<string, string> = {
  win32: 'win32',
  darwin: 'darwin',
  linux: 'linux',
  freebsd: 'freebsd',
  openbsd: 'openbsd',
  sunos: 'sunos',
  aix: 'aix',
};
const NPM_ARCH_MAP: Record<string, string> = {
  x64: 'x64',
  arm64: 'arm64',
  arm: 'arm',
  ia32: 'ia32',
  mips: 'mipsel',
  ppc64: 'ppc64',
  s390: 's390x',
};

// ── Helpers ───────────────────────────────────────────────────────

const REPO_ROOT = resolve(import.meta.dirname, '..');

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
  if (!DEPLOY_PROD_PATH) missing.push('DEPLOY_PROD_PATH');
  if (!DEPLOY_STAGING_PATH) missing.push('DEPLOY_STAGING_PATH');

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

/**
 * Pre-flight: detect a cross-platform node_modules (e.g. Windows
 * binaries on the Linux NAS) before any step tries to use them.
 *
 * npm's optional native dependencies (notably esbuild) are written
 * with native code and need a platform-specific binary. If node_modules
 * was last installed on a different platform, the first step that
 * uses one of them fails with a confusing "You installed esbuild for
 * another platform" error. The fix is to run `npm ci` so npm lays
 * down the correct binaries for the current OS/CPU.
 *
 * Detection strategy: look in node_modules for any
 * `@esbuild/<wrong-platform>` subdir (or any of the well-known
 * optional-native packages that ship a per-platform binary). If the
 * current platform's variant is missing but a wrong-platform variant
 * is present, run `npm ci` to fix.
 */
function checkPlatformBinaries(): void {
  const currentOs = NPM_OS_MAP[process.platform];
  const currentArch = NPM_ARCH_MAP[process.arch];
  if (!currentOs || !currentArch) {
    // Unknown platform (e.g. freebsd on a node build that doesn't list
    // it). Let later steps fail loudly rather than silently rebuilding.
    return;
  }
  const currentTriple = `${currentOs}-${currentArch}`;

  const candidates: Array<{ pkg: string; dir: string }> = [
    { pkg: 'esbuild', dir: 'node_modules/@esbuild' },
  ];

  for (const { pkg, dir } of candidates) {
    const base = resolve(REPO_ROOT, dir);
    if (!existsSync(base)) continue;
    const entries = readdirSync(base);
    // A platform triple is exactly "{os}-{arch}", e.g. "linux-x64" or
    // "win32-x64". Anything else (e.g. sharp's "colour" subdir) is
    // platform-independent and not relevant.
    const platformEntries = entries.filter((e) => /^[^-]+-[^-]+$/.test(e));
    const hasCurrent = platformEntries.includes(currentTriple);
    const wrongEntries = platformEntries.filter((e) => e !== currentTriple);
    if (hasCurrent || wrongEntries.length === 0) continue;

    console.error('');
    console.error(`✗ Detected cross-platform node_modules:`);
    console.error(`  Found ${pkg} for: ${wrongEntries.join(', ')}`);
    console.error(`  Current platform needs:    ${currentTriple}`);
    console.error(
      `  This usually means node_modules was last installed on a different`,
    );
    console.error(
      `  OS (e.g. you developed on Windows and ran publish on Linux).`,
    );
    console.error('');
    console.error(`Reinstalling dependencies for ${currentTriple}...`);

    try {
      execFileSync('npm', ['ci'], {
        cwd: REPO_ROOT,
        stdio: 'inherit',
        timeout: 15 * 60 * 1000, // 15 min cap
        shell: process.platform === 'win32',
      });
      console.log('✓ npm ci complete — re-run publish');
    } catch (err) {
      console.error('✗ npm ci FAILED — run `npm ci` manually and re-try');
      console.error(err);
      process.exit(1);
    }
    process.exit(0); // exit 0; the user re-runs publish with a clean tree
  }
}

/**
 * Pre-flight: detect a node_modules installed with optional native
 * deps for the wrong platform. If found, surface a helpful hint about
 * the `--target-platform` workaround or a `npm rebuild` — most of
 * these packages can be re-built for the current platform from source
 * if a C toolchain is available.
 *
 * We only detect (don't auto-fix) here because the fix varies by
 * package: esbuild is shipped as a prebuilt binary, while
 * better-sqlite3 / bcrypt / sharp are built from source. Auto-fixing
 * the wrong case risks triggering a long native build when the user
 * just wants to know what's wrong.
 */
function warnOnWrongOptionalPlatform(): void {
  const currentOs = NPM_OS_MAP[process.platform];
  const currentArch = NPM_ARCH_MAP[process.arch];
  if (!currentOs || !currentArch) return;
  const currentTriple = `${currentOs}-${currentArch}`;

  const knownOptionals = [
    { pkg: 'esbuild', dir: 'node_modules/@esbuild' },
    { pkg: 'better-sqlite3', dir: 'node_modules/@libsql/client' },
    { pkg: 'sharp', dir: 'node_modules/@img' },
  ];
  for (const { pkg, dir } of knownOptionals) {
    const base = resolve(REPO_ROOT, dir);
    if (!existsSync(base)) continue;
    const entries = readdirSync(base);
    // Skip non-platform entries (e.g. sharp's "colour" subdir).
    const platformEntries = entries.filter((e) => /^[^-]+-[^-]+$/.test(e));
    if (platformEntries.length === 0) continue;
    const hasCurrent = platformEntries.includes(currentTriple);
    if (hasCurrent) continue;
    console.error(
      `⚠ ${pkg} is present for another platform (${platformEntries.join(', ')}); ` +
        `current needs ${currentTriple}.`,
    );
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

  const sshCmd = `ssh -p ${DEPLOY_PORT} -i "${DEPLOY_KEY}" -o StrictHostKeyChecking=accept-new`;
  const rsyncArgs = [
    '-avz', '--delete',
    '-e', sshCmd,
    'dist/',
    `${DEPLOY_USER}@${DEPLOY_HOST}:${targetPath}`,
  ];

  console.log(`$ rsync ${rsyncArgs.join(' ')}`);

  try {
    execFileSync('rsync', rsyncArgs, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      timeout: 10 * 60 * 1000, // 10 min cap for rsync
      shell: process.platform === 'win32',
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
  console.log('══════════════════════════════════════════════════════');

  validateConfig();
  checkPlatformBinaries();
  warnOnWrongOptionalPlatform();

  // Step 1: Refresh data
  runStep('data:build', 'npm', ['run', 'data:build']);

  // Step 2: Validate
  runStep('data:validate', 'npm', ['run', 'data:validate']);

  // Step 3: Build site
  runStep('build', 'npm', ['run', 'build']);

  // Step 4: Deploy
  rsync();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  ✓ Publish complete — ${mode} — ${elapsed}s`);
  console.log('══════════════════════════════════════════════════════\n');
}

main();
