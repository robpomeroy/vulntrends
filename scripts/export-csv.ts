/**
 * CSV export script — generates one CSV per chart from the aggregated
 * JSON in `src/data/aggregated/`. Output goes to `public/data/` so the
 * files are served as static assets (same pattern as `robots.txt.ts`).
 *
 * The CSVs power the "Download CSV" buttons on the four
 * `src/pages/charts/*.astro` click-through pages. Each CSV includes a
 * header comment (rows starting with `#`) carrying provenance metadata
 * so the file travels with its origins — important for a
 * cybersecurity-adjacent dataset that may be cited downstream.
 *
 * Usage: `npm run data:csv` (invoked by `npm run publish` before
 * `astro build`, since the CSV files need to exist before the static
 * pages are generated).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  BacklogPoint,
  PatchLagPoint,
  PipelineMeta,
  TimeSeriesPoint,
} from './pipeline/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'src', 'data');
const AGG_DIR = join(DATA_DIR, 'aggregated');
// Output to public/ so Astro copies CSVs into dist/data/ verbatim and
// serves them at /data/<file>.cs v. Same pattern as og-image.jpg.
const PUBLIC_DATA_DIR = resolve(__dirname, '..', 'public', 'data');

async function readJson<T>(path: string): Promise<T> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Format a provenance header as `#` comment lines. CSV readers
 * commonly accept this (Excel treats `#` lines as orphaned text;
 * R/pandas/duckdb honour `comment='#'`).
 */
function provenanceHeader(meta: PipelineMeta, chartName: string): string {
  const lines = [
    `# VulnTrends — ${chartName}`,
    `# Generated: ${meta.lastUpdated}`,
    `# Total records: ${meta.totalRecords}`,
    `# Records per source: ${Object.entries(meta.sourceCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `# Source: https://vulntrends.org`,
    `#`,
  ];
  return lines.join('\n');
}

/** Escape a CSV cell. Wraps in quotes if it contains comma/quote/newline. */
function csvCell(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialise a row of values as a CSV line. */
function csvRow(values: Array<string | number | undefined | null>): string {
  return values.map(csvCell).join(',');
}

/** Convert a discovered/fixed point to a CSV row. */
function timeSeriesRow(p: TimeSeriesPoint): string {
  return csvRow([p.date, p.manufacturer, p.count]);
}

/** Convert a backlog point to a CSV row. */
function backlogRow(p: BacklogPoint): string {
  return csvRow([p.date, p.manufacturer, p.openCount]);
}

/** Convert a patch-lag point to a CSV row. */
function patchLagRow(p: PatchLagPoint): string {
  return csvRow([
    p.date,
    p.manufacturer,
    p.medianLagDays,
    p.p90LagDays,
    p.knownCount,
    p.totalCount,
  ]);
}

async function writeCsv(
  filename: string,
  chartName: string,
  header: string[],
  rows: string[],
  meta: PipelineMeta,
): Promise<void> {
  const content =
    provenanceHeader(meta, chartName) +
    header.join(',') +
    '\n' +
    rows.join('\n') +
    '\n';
  await writeFile(join(PUBLIC_DATA_DIR, filename), content, 'utf-8');
  console.log(`  ✓ public/data/${filename} (${rows.length} rows)`);
}

interface SeverityMixPoint {
  date: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  count: number;
}

function severityMixRow(p: SeverityMixPoint): string {
  return csvRow([p.date, p.severity, p.count]);
}

async function main(): Promise<void> {
  console.log('=== VulnTrends CSV export ===\n');

  const meta = await readJson<PipelineMeta>(join(DATA_DIR, 'meta.json'));
  await mkdir(PUBLIC_DATA_DIR, { recursive: true });

  // Monthly variants — preferred default
  const discoveredMonth = await readJson<TimeSeriesPoint[]>(
    join(AGG_DIR, 'discovered-by-month.json'),
  );
  await writeCsv(
    'discovered.csv',
    'Vulnerabilities discovered (monthly)',
    ['date', 'manufacturer', 'count'],
    discoveredMonth.map(timeSeriesRow),
    meta,
  );

  const fixedMonth = await readJson<TimeSeriesPoint[]>(
    join(AGG_DIR, 'fixed-by-month.json'),
  );
  await writeCsv(
    'fixed.csv',
    'Vulnerabilities fixed (monthly)',
    ['date', 'manufacturer', 'count'],
    fixedMonth.map(timeSeriesRow),
    meta,
  );

  const patchLagMonth = await readJson<PatchLagPoint[]>(
    join(AGG_DIR, 'patch-lag-by-month.json'),
  );
  await writeCsv(
    'patch-lag.csv',
    'Patch lag (monthly)',
    ['date', 'manufacturer', 'medianLagDays', 'p90LagDays', 'knownCount', 'totalCount'],
    patchLagMonth.map(patchLagRow),
    meta,
  );

  const backlogMonth = await readJson<BacklogPoint[]>(
    join(AGG_DIR, 'backlog-by-month.json'),
  );
  await writeCsv(
    'backlog.csv',
    'Vulnerability backlog (monthly)',
    ['date', 'manufacturer', 'openCount'],
    backlogMonth.map(backlogRow),
    meta,
  );

  const severityMixMonth = await readJson<SeverityMixPoint[]>(
    join(AGG_DIR, 'severity-mix-by-month.json'),
  );
  await writeCsv(
    'severity-mix.csv',
    'Severity mix (monthly)',
    ['date', 'severity', 'count'],
    severityMixMonth.map(severityMixRow),
    meta,
  );

  console.log(`\nCSVs written to public/data/`);
}

main().catch((err) => {
  console.error('CSV export failed:', err);
  process.exit(1);
});