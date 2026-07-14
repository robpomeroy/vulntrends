#!/usr/bin/env node
/**
 * Pre-flight check for `npm run publish` — runs in plain Node BEFORE
 * tsx/esbuild is loaded, so it can detect a cross-platform
 * `node_modules` even if esbuild itself is the broken package.
 *
 * Why this exists as a separate script:
 *   `npm run publish` invokes `tsx scripts/publish.ts`. tsx depends
 *   on esbuild, which loads its native binary on import. If
 *   `node_modules` is installed for the wrong platform, esbuild
 *   throws an uncaught `TransformError` at module-load time, before
 *   any code in `publish.ts` runs — including the pre-flight check
 *   that lives in `publish.ts`. The check has to run OUTSIDE tsx to
 *   ever get a chance to fire.
 *
 * What it does:
 *   1. Scans `node_modules/@esbuild/` for any platform triple that
 *      isn't the current `{os}-{arch}`. If only wrong-platform
 *      triples are present, runs `npm ci` and exits. The user
 *      re-runs `npm run publish` and gets a clean tree.
 *   2. Warns (but does not fix) for other known optional-native
 *      packages whose fix varies (better-sqlite3, sharp) — auto-
 *      triggering a long native build is unfriendly.
 *
 * The detection only counts entries shaped like `{os}-{arch}` (e.g.
 * `linux-x64`, `win32-x64`) so platform-independent subdirs (e.g.
 * sharp's `colour` subdir) don't trigger false positives.
 *
 * Exit codes:
 *   0  — OK (or after a successful self-fix npm ci)
 *   1  — npm ci failed; user must intervene
 *
 * Cross-platform: written in plain ES modules using only Node built-
 * ins, so it runs identically on Windows and Linux with no deps.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Map from Node's process.platform / process.arch to the names npm
// uses in @<scope>/<pkg>-<os>-<arch> subdirs.
const NPM_OS_MAP = {
  win32: 'win32',
  darwin: 'darwin',
  linux: 'linux',
  freebsd: 'freebsd',
  openbsd: 'openbsd',
  sunos: 'sunos',
  aix: 'aix',
};
const NPM_ARCH_MAP = {
  x64: 'x64',
  arm64: 'arm64',
  arm: 'arm',
  ia32: 'ia32',
  mips: 'mipsel',
  ppc64: 'ppc64',
  s390: 's390x',
};

const PLATFORM_TRIPLE_RE = /^[^-]+-[^-]+$/;

function currentTriple() {
  const os = NPM_OS_MAP[process.platform];
  const arch = NPM_ARCH_MAP[process.arch];
  if (!os || !arch) return null;
  return `${os}-${arch}`;
}

function listPlatformEntries(dirRel) {
  const base = resolve(REPO_ROOT, dirRel);
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((e) => PLATFORM_TRIPLE_RE.test(e));
}

/**
 * Returns true if a wrong-platform install was detected AND a fresh
 * `npm ci` was successfully run. The caller should exit 0 in that
 * case and tell the user to re-run publish.
 *
 * Returns false if everything's fine (current platform is present, or
 * no platform-specific package is installed at all). The caller
 * should continue.
 *
 * Throws (calls process.exit(1)) if npm ci fails.
 */
function checkPlatformBinaries() {
  const triple = currentTriple();
  if (!triple) return false; // unknown platform — let later steps fail loudly

  // esbuild ships as a prebuilt binary per platform; this is the
  // primary offender. Add more `{pkg, dir}` entries here as needed.
  const hardCandidates = [
    { pkg: 'esbuild', dir: 'node_modules/@esbuild' },
  ];

  for (const { pkg, dir } of hardCandidates) {
    const platformEntries = listPlatformEntries(dir);
    if (platformEntries.length === 0) continue;
    const hasCurrent = platformEntries.includes(triple);
    const wrong = platformEntries.filter((e) => e !== triple);
    if (hasCurrent || wrong.length === 0) continue;

    console.error('');
    console.error(`✗ Detected cross-platform node_modules for ${pkg}:`);
    console.error(`  Found:     ${wrong.join(', ')}`);
    console.error(`  Need:      ${triple}`);
    console.error(
      `  This usually means node_modules was last installed on a different`,
    );
    console.error(
      `  OS (e.g. you developed on Windows and ran publish on Linux).`,
    );
    console.error('');
    console.error(`Reinstalling dependencies for ${triple}...`);

    try {
      execFileSync('npm', ['ci'], {
        cwd: REPO_ROOT,
        stdio: 'inherit',
        timeout: 15 * 60 * 1000, // 15 min cap
        shell: process.platform === 'win32', // npm.cmd on Windows
      });
    } catch (err) {
      console.error('');
      console.error('✗ npm ci FAILED — run `npm ci` manually and re-try.');
      console.error(err);
      process.exit(1);
    }

    console.log('');
    console.log('✓ npm ci complete. Re-run `npm run publish` to continue.');
    return true;
  }
  return false;
}

/**
 * Soft check: warn about optional-native packages that are installed
 * for a different platform. We don't auto-fix because the fix
 * varies — esbuild uses prebuilt binaries, while better-sqlite3 /
 * sharp / bcrypt etc. are built from source. Auto-triggering a long
 * native build when the user just wants to know what's wrong is
 * unfriendly.
 */
function warnOnWrongOptionalPlatform() {
  const triple = currentTriple();
  if (!triple) return;

  const knownOptionals = [
    { pkg: 'esbuild', dir: 'node_modules/@esbuild' },
    { pkg: 'better-sqlite3', dir: 'node_modules/@libsql/client' },
    { pkg: 'sharp', dir: 'node_modules/@img' },
  ];

  for (const { pkg, dir } of knownOptionals) {
    const platformEntries = listPlatformEntries(dir);
    if (platformEntries.length === 0) continue;
    if (platformEntries.includes(triple)) continue;
    console.warn(
      `⚠ ${pkg} is present for another platform ` +
        `(${platformEntries.join(', ')}); current needs ${triple}. ` +
        `Run 'npm rebuild' (or 'npm ci') to fix.`,
    );
  }
}

const fixed = checkPlatformBinaries();
if (!fixed) {
  warnOnWrongOptionalPlatform();
  // No fix needed — signal success so the calling npm script chain
  // proceeds to the next step.
  process.exit(0);
}
// checkPlatformBinaries already ran npm ci; exit 0 so the chain
// doesn't proceed with a half-installed tree.
process.exit(0);
