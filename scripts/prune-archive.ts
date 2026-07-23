/**
 * Prune old snapshots according to the retention policy.
 *
 *  - Daily snapshots for the last 90 days
 *  - Monthly snapshots (1st of month) for the previous 5 years
 *  - Yearly snapshots (Jan 1) thereafter
 *
 * Runs automatically as part of the monthly publish cycle (or manually
 * via `npm run data:prune`). Never deletes the most recent 7 days even
 * if outside the retention windows — safety margin for debugging.
 */

import { readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = resolve(__dirname, '..', 'data-archive');

const RECENT_DAYS = 90;
const MONTHLY_YEARS = 5;
const SAFETY_RECENT_DAYS = 7;

/** Parse "YYYY-MM-DD" into a Date at UTC midnight. */
function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

/** Decide which snapshots to keep. */
function shouldKeep(snapshotDate: string, today: Date): boolean {
  const ageDays = daysBetween(parseDate(snapshotDate), today);

  // Always keep the most recent week for debugging
  if (ageDays <= SAFETY_RECENT_DAYS) return true;

  // Daily for the last 90 days
  if (ageDays <= RECENT_DAYS) return true;

  // Monthly (1st of month) for the previous 5 years
  const [, mm, dd] = snapshotDate.split('-');
  if (dd === '01' && ageDays <= RECENT_DAYS + MONTHLY_YEARS * 365) {
    return true;
  }

  // Yearly (Jan 1) for everything older
  if (mm === '01' && dd === '01') return true;

  return false;
}

async function main(): Promise<void> {
  console.log('=== VulnTrends archive prune ===\n');

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);

  let entries: string[];
  try {
    entries = await readdir(ARCHIVE_DIR);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      console.log('  No archive directory found — nothing to prune');
      return;
    }
    throw err;
  }

  const snapshotDirs = entries.filter(
    (e) => /^\d{4}-\d{2}-\d{2}$/.test(e) && e !== todayIso,
  );

  let kept = 0;
  let pruned = 0;

  for (const date of snapshotDirs) {
    if (shouldKeep(date, today)) {
      kept++;
    } else {
      await rm(join(ARCHIVE_DIR, date), { recursive: true, force: true });
      console.log(`  ✗ pruned ${date}`);
      pruned++;
    }
  }

  console.log(`\nPrune complete: ${kept} kept, ${pruned} pruned`);
}

main().catch((err) => {
  console.error('Prune failed:', err);
  process.exit(1);
});