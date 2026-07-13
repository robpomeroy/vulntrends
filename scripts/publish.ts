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

const targetPath = staging
  ? DEPLOY_STAGING_PATH
  : DEPLOY_PROD_PATH;

const targetLabel = staging ? 'staging' : 'production';

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

function rsync(): void {
  if (dryRun) {
    console.log('\n── rsync (skipped — dry-run) ────────────────────');
    console.log(`Would rsync dist/ → ${DEPLOY_USER}@${DEPLOY_HOST}:${targetPath}`);
    return;
  }

  console.log(`\n── rsync → ${targetLabel} ───────────────────────────`);
  console.log(`  host: ${DEPLOY_HOST}:${DEPLOY_PORT}`);
  console.log(`  user: ${DEPLOY_USER}`);
  console.log(`  path: ${targetPath}`);

  const sshCmd = `ssh -p ${DEPLOY_PORT} -i ${DEPLOY_KEY} -o StrictHostKeyChecking=accept-new`;
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
