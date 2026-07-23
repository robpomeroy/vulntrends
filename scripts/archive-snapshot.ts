/**
 * Snapshot archive — Tier-2 retention.
 *
 * After every successful `data:build`, copy `raw/all.json` and `meta.json`
 * into `data-archive/<YYYY-MM-DD>/` and update `data-archive/manifest.json`
 * with sha256 checksums. This gives us:
 *
 *  - **Recovery**: if a future parser regression defeats the silent-empty
 *    safeguard, `git checkout data-archive/<date>/` restores a known-good
 *    dataset. The 2026-07-20 incident (gitignored data + silent-empty
 *    success) was the canonical failure mode; the archive prevents the
 *    next one.
 *
 *  - **Auditability**: diff snapshots between runs to see exactly what
 *    NVD/MSRC/etc. changed (e.g. the next MSRC-style bulk re-stamp).
 *
 *  - **Reproducibility**: the aggregated charts for any historical date
 *    can be regenerated from the snapshot.
 *
 * The archive directory is intended to be committed to the repo (or to a
 * separate `vulntrends-data` repo if size becomes a concern). Snapshots
 * are append-only — never modify a past snapshot's files. If a run is
 * bad, delete the snapshot directory and re-run.
 *
 * Retention policy (enforced by `scripts/prune-archive.ts`):
 *  - Daily snapshots for the last 90 days
 *  - Monthly snapshots (1st of month) for the previous 5 years
 *  - Yearly snapshots (Jan 1) thereafter
 *
 * Usage: `npm run data:archive` (called by `npm run publish`).
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'src', 'data');
const ARCHIVE_DIR = resolve(__dirname, '..', 'data-archive');

/**
 * SHA-256 hex digest of the file contents. Used in the manifest so any
 * bit-rot or accidental edit is detected on the next load.
 */
async function sha256(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * The set of files archived per snapshot. `meta.json` and `all.json` are
 * the canonical record; per-source files can be reconstructed from
 * `all.json` (which has a `source` field on each record) but we keep
 * them anyway because they're useful for debugging individual sources.
 */
const ARCHIVE_FILES = [
  'meta.json',
  'raw/all.json',
  'raw/mozilla.json',
  'raw/chrome.json',
  'raw/msrc.json',
  'raw/apple.json',
  'raw/projectzero.json',
  'raw/pan.json',
  'raw/fortinet.json',
  'raw/cisco.json',
  'raw/adobe.json',
  'raw/nvd.json',
] as const;

interface ManifestEntry {
  date: string;
  files: Record<string, string>;
  totalBytes: number;
}

interface Manifest {
  /** Schema version. Bump if the format changes. */
  version: 1;
  /** ISO date of the last update. */
  lastUpdated: string;
  /** Snapshots, newest first. */
  snapshots: ManifestEntry[];
}

async function main(): Promise<void> {
  console.log('=== VulnTrends snapshot archive ===\n');

  const today = new Date().toISOString().slice(0, 10);
  const snapshotDir = join(ARCHIVE_DIR, today);

  console.log(`Creating snapshot for ${today}...`);
  await mkdir(snapshotDir, { recursive: true });

  const files: Record<string, string> = {};
  let totalBytes = 0;

  for (const relPath of ARCHIVE_FILES) {
    const src = join(DATA_DIR, relPath);
    const dst = join(snapshotDir, relPath);
    await mkdir(dirname(dst), { recursive: true });

    try {
      const content = await readFile(src);
      await writeFile(dst, content);
      const hash = createHash('sha256').update(content).digest('hex');
      files[relPath] = hash;
      totalBytes += content.byteLength;
      console.log(`  ✓ ${relPath} (${(content.byteLength / 1024).toFixed(1)} KB) → ${hash.slice(0, 12)}…`);
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        console.log(`  - ${relPath} (not found, skipped)`);
      } else {
        throw err;
      }
    }
  }

  // Update manifest
  const manifestPath = join(ARCHIVE_DIR, 'manifest.json');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as Manifest;
    if (manifest.version !== 1) {
      throw new Error(`Unsupported manifest version: ${manifest.version}`);
    }
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      manifest = { version: 1, lastUpdated: today, snapshots: [] };
    } else {
      throw err;
    }
  }

  // Replace any existing entry for today (idempotent re-runs)
  manifest.snapshots = manifest.snapshots.filter((s) => s.date !== today);
  manifest.snapshots.unshift({
    date: today,
    files,
    totalBytes,
  });
  manifest.lastUpdated = today;

  await writeFile(
    manifestPath,
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  );
  console.log(`\nManifest updated: ${manifest.snapshots.length} snapshots, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total for ${today}`);

  // Verify all hashes against on-disk content. Catches bit-rot and
  // accidental edits introduced between the archive and manifest writes.
  console.log('\nVerifying snapshot integrity...');
  for (const [relPath, expectedHash] of Object.entries(files)) {
    const actualHash = await sha256(join(snapshotDir, relPath));
    if (actualHash !== expectedHash) {
      throw new Error(
        `Hash mismatch for ${relPath}: expected ${expectedHash}, got ${actualHash}`,
      );
    }
  }
  console.log(`  ✓ all ${Object.keys(files).length} files verified`);
  console.log(`\nSnapshot complete: ${snapshotDir}`);
}

main().catch((err) => {
  console.error('Archive failed:', err);
  process.exit(1);
});