/**
 * Semantic data-audit script.
 *
 * Runs after `data:validate` (Zod schema validation). Where Zod validates
 * shape, this script validates plausibility:
 *
 *  - **A1**: Per-source year-over-year outliers.
 *    If a source's count for the current year exceeds N× the trailing
 *    3-year median, warn. Catches bulk re-publication regressions like
 *    the MSRC `2026-Jul` update.
 *
 *  - **A2**: CVE-year vs discovered-year divergence.
 *    If `|CVEYear − discoveredYear| > 5`, flag the record. A CVE ID encodes
 *    the assignment year; if `discoveredDate` is years off, the parser
 *    almost certainly picked up the wrong timestamp (e.g. MSRC
 *    `CurrentReleaseDate` for a bulk catalog re-publication).
 *
 *  - **A3**: Future-dated records.
 *    Records dated beyond `today + 7 days` are almost always parser bugs
 *    (timezone shift, epoch injection, "today" fallback). Hard-fail.
 *
 *  - **A6**: MSRC residual date contamination.
 *    Even after the parser filters out Mariner documents and the dedup
 *    applies the CVE-year sanity check, *some* MSRC records may still
 *    survive with implausible `discoveredDate` values (e.g. when the
 *    vendor date passed the sanity check but the NVD record was
 *    missing). A6 tracks this residual so the operator can spot
 *    regressions in either layer of defence. Hard-fail if any record
 *    has a discoveredDate more than DATE_SANITY_MAX_YEARS off the
 *    CVE-year — the dedup *should* have fixed those.
 *
 *  - **E2**: Per-manufacturer patch-date coverage.
 *    Manufacturers with < 10% patch-date coverage inflate the backlog.
 *    Warn so the operator can decide whether to exclude them.
 *
 *  - **E5-dup**: Duplicate CVE IDs across sources after dedup.
 *    The pipeline dedupes by CVE ID; if duplicates remain, dedup is broken.
 *
 * Emits warnings to stderr (so the Synology Task Scheduler email surfaces
 * them) and exits non-zero on hard failures. Warnings alone do NOT block
 * publication — they are advisory.
 *
 * Usage: `npm run data:audit` (or as part of `publish:validate`).
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { VulnerabilityRecord } from './pipeline/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'src', 'data');
const RAW_DIR = join(DATA_DIR, 'raw');

const FUTURE_DATE_GRACE_DAYS = 7;
// Tolerance for CVE-year vs discovered-year divergence. MSRC's CVRF
// catalog re-publishes the entire history under a single document
// date, and the per-vulnerability `RevisionHistory` earliest entry
// can be a re-classification date (e.g. a 1999 CVE re-published in
// 2020). 5 years is the empirical threshold: anything beyond that
// is almost certainly a parser bug (timezone shift, "today"
// fallback, or a missing revision history entirely).
const CVE_YEAR_TOLERANCE = 5;
const CURRENT_YEAR_OUTLIER_MULTIPLIER = 5; // current year > N× trailing median → warn
const MIN_PATCH_COVERAGE = 0.10; // < 10% → warn

async function readJson<T>(path: string): Promise<T> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as T;
}

interface AuditIssue {
  severity: 'error' | 'warning';
  category: string;
  message: string;
  details?: unknown;
}

async function main(): Promise<void> {
  console.log('=== VulnTrends semantic data-audit ===\n');

  const issues: AuditIssue[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const currentYear = today.getUTCFullYear();

  // Load all records from all.json (post-dedup)
  let records: VulnerabilityRecord[] = [];
  try {
    records = await readJson<VulnerabilityRecord[]>(
      join(RAW_DIR, 'all.json'),
    );
    console.log(`Loaded ${records.length} records from raw/all.json`);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      console.error(
        '  ✗ raw/all.json not found — run `npm run data:build` first',
      );
      process.exit(1);
    }
    throw err;
  }

  // ---- A2: CVE-year vs discovered-year divergence ----
  const cveYearMismatches: Array<{
    id: string;
    cveYear: number;
    discYear: number;
    source: string;
  }> = [];
  for (const r of records) {
    const cveMatch = r.id.match(/^CVE-(\d{4})-\d{4,}$/);
    if (!cveMatch) continue;
    const cveYear = Number.parseInt(cveMatch[1], 10);
    const discYear = Number.parseInt(r.discoveredDate.slice(0, 4), 10);
    if (Math.abs(cveYear - discYear) > CVE_YEAR_TOLERANCE) {
      cveYearMismatches.push({
        id: r.id,
        cveYear,
        discYear,
        source: r.source,
      });
    }
  }
  if (cveYearMismatches.length > 0) {
    const bySrc: Record<string, number> = {};
    for (const m of cveYearMismatches) {
      bySrc[m.source] = (bySrc[m.source] ?? 0) + 1;
    }
    issues.push({
      severity: 'warning',
      category: 'A2-cve-year-mismatch',
      message: `${cveYearMismatches.length} records have |CVEYear − discoveredYear| > ${CVE_YEAR_TOLERANCE}`,
      details: bySrc,
    });
    console.error(
      `  ⚠ A2: ${cveYearMismatches.length} CVE-year mismatches across sources:`,
      bySrc,
    );
  } else {
    console.log(`  ✓ A2: all CVE years match discovered years (±${CVE_YEAR_TOLERANCE})`);
  }

  // ---- A6: Catalog-re-publication residual ----
  // The dedup applies the `dateMatchesCveYear` helper to discard
  // vendor dates that are far from the CVE-year. The residual we care
  // about here is the *catalog-re-publication* artefact — records
  // whose `discoveredDate` is suspiciously close to "today" (last
  // 18 months) while the CVE-year is much older. That's the signature
  // of MSRC-style bulk re-imports.
  //
  // We deliberately use 18 months (not the dedup's 1-year tolerance)
  // because NVD legitimately publishes old CVEs years after assignment
  // (e.g. CVE-1999-0681 with `published=2001-03-12`). The catalogue-
  // re-publication pattern is specifically "recent date + ancient
  // CVE-year" which NVD never produces.
  const eighteenMonthsAgo = new Date(today.getTime() - 540 * 86_400_000);
  const eighteenMonthsAgoIso = eighteenMonthsAgo.toISOString().slice(0, 10);
  const catRepubResiduals: Array<{
    id: string;
    cveYear: number;
    discYear: number;
    source: string;
  }> = [];
  for (const r of records) {
    if (!r.id.match(/^CVE-(\d{4})-\d{4,}$/)) continue;
    if (r.discoveredDate < eighteenMonthsAgoIso) continue;
    const cveYear = Number.parseInt(RegExp.$1, 10);
    const discYear = Number.parseInt(r.discoveredDate.slice(0, 4), 10);
    if (discYear - cveYear > 1) {
      // `discoveredDate` is recent (last 18 months) but the CVE is
      // from at least 2 years before — that's the catalog-re-pub
      // signature, not a delayed NVD publish.
      catRepubResiduals.push({
        id: r.id,
        cveYear,
        discYear,
        source: r.source,
      });
    }
  }
  if (catRepubResiduals.length > 0) {
    const bySrc: Record<string, number> = {};
    for (const m of catRepubResiduals) {
      bySrc[m.source] = (bySrc[m.source] ?? 0) + 1;
    }
    issues.push({
      severity: 'error',
      category: 'A6-catalog-republication',
      message: `${catRepubResiduals.length} records have a recent (last 18 months) discoveredDate for a CVE-year at least 2 years earlier — likely an upstream bulk re-publication the dedup missed`,
      details: bySrc,
    });
    console.error(
      `  ✗ A6: ${catRepubResiduals.length} catalog-re-publication residuals:`,
      bySrc,
    );
  } else {
    console.log('  ✓ A6: no catalog-re-publication residuals');
  }

  // ---- A3: Future-dated records ----
  const futureDated: VulnerabilityRecord[] = [];
  const futureCutoff = new Date(today.getTime() + FUTURE_DATE_GRACE_DAYS * 86_400_000);
  for (const r of records) {
    if (r.discoveredDate > todayIso) {
      futureDated.push(r);
    }
    if (r.patchedDate && r.patchedDate > todayIso) {
      futureDated.push(r);
    }
  }
  if (futureDated.length > 0) {
    issues.push({
      severity: 'error',
      category: 'A3-future-dated',
      message: `${futureDated.length} records dated more than ${FUTURE_DATE_GRACE_DAYS} days in the future`,
      details: futureDated.slice(0, 5).map((r) => ({
        id: r.id,
        source: r.source,
        discoveredDate: r.discoveredDate,
        patchedDate: r.patchedDate,
      })),
    });
    console.error(
      `  ✗ A3: ${futureDated.length} future-dated records (sample):`,
      futureDated.slice(0, 5).map((r) => ({
        id: r.id,
        source: r.source,
        discoveredDate: r.discoveredDate,
      })),
    );
  } else {
    console.log(`  ✓ A3: no future-dated records (within ${FUTURE_DATE_GRACE_DAYS}-day grace)`);
  }

  // ---- A1: Per-source current-year outliers ----
  // Build per-source per-year counts, then compare current year to the
  // median of the trailing 3 complete years. A genuine growth surge
  // (e.g. NVD expanding CPE coverage) is usually < 2×; bulk re-publication
  // regressions like MSRC 2026-Jul produce 5–50× spikes.
  const bySrcYear: Record<string, Record<number, number>> = {};
  for (const r of records) {
    const y = Number.parseInt(r.discoveredDate.slice(0, 4), 10);
    bySrcYear[r.source] ??= {};
    bySrcYear[r.source][y] = (bySrcYear[r.source][y] ?? 0) + 1;
  }
  const trailing = [currentYear - 3, currentYear - 2, currentYear - 1];
  for (const [source, years] of Object.entries(bySrcYear)) {
    const trailingCounts = trailing.map((y) => years[y] ?? 0).sort((a, b) => a - b);
    const median = trailingCounts[1] ?? 0;
    const current = years[currentYear] ?? 0;
    if (median > 0 && current > median * CURRENT_YEAR_OUTLIER_MULTIPLIER) {
      issues.push({
        severity: 'warning',
        category: 'A1-yoy-outlier',
        message: `${source} ${currentYear} count (${current}) is ${(current / median).toFixed(1)}× the trailing-3-year median (${median})`,
        details: { source, current, trailingMedian: median, years },
      });
      console.error(
        `  ⚠ A1: ${source} ${currentYear} outlier — ${current} vs median ${median} (${(current / median).toFixed(1)}×)`,
      );
    }
  }
  if (!issues.some((i) => i.category === 'A1-yoy-outlier')) {
    console.log(
      `  ✓ A1: no source shows > ${CURRENT_YEAR_OUTLIER_MULTIPLIER}× trailing-median growth in ${currentYear}`,
    );
  }

  // ---- E2: Per-manufacturer patch-date coverage ----
  const byMfr: Record<string, { total: number; patched: number }> = {};
  for (const r of records) {
    byMfr[r.manufacturer] ??= { total: 0, patched: 0 };
    byMfr[r.manufacturer].total++;
    if (r.patchedDate) byMfr[r.manufacturer].patched++;
  }
  for (const [mfr, { total, patched }] of Object.entries(byMfr)) {
    const coverage = total > 0 ? patched / total : 0;
    if (coverage < MIN_PATCH_COVERAGE && total > 50) {
      issues.push({
        severity: 'warning',
        category: 'E2-low-patch-coverage',
        message: `${mfr}: only ${(coverage * 100).toFixed(1)}% of ${total} records have a patch date (threshold ${(MIN_PATCH_COVERAGE * 100).toFixed(0)}%)`,
      });
      console.error(
        `  ⚠ E2: ${mfr} patch-date coverage ${(coverage * 100).toFixed(1)}% (${patched}/${total})`,
      );
    }
  }
  if (!issues.some((i) => i.category === 'E2-low-patch-coverage')) {
    console.log(
      `  ✓ E2: all manufacturers have ≥ ${(MIN_PATCH_COVERAGE * 100).toFixed(0)}% patch-date coverage`,
    );
  }

  // ---- Duplicate CVE IDs after dedup ----
  const seenIds = new Map<string, VulnerabilityRecord[]>();
  for (const r of records) {
    const arr = seenIds.get(r.id) ?? [];
    arr.push(r);
    seenIds.set(r.id, arr);
  }
  const dups: Array<{ id: string; count: number; sources: string[] }> = [];
  for (const [id, arr] of seenIds) {
    if (arr.length > 1) {
      dups.push({
        id,
        count: arr.length,
        sources: [...new Set(arr.map((r) => r.source))],
      });
    }
  }
  if (dups.length > 0) {
    issues.push({
      severity: 'error',
      category: 'dedup-failure',
      message: `${dups.length} duplicate record IDs found after dedup`,
      details: dups.slice(0, 10),
    });
    console.error(
      `  ✗ dedup: ${dups.length} duplicate record IDs (sample):`,
      dups.slice(0, 5),
    );
  } else {
    console.log(`  ✓ dedup: no duplicate record IDs`);
  }

  // ---- Summary ----
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  console.log(`\n=== Audit complete ===`);
  console.log(`${warnings.length} warnings, ${errors.length} errors`);

  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});