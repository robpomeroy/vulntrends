/**
 * Sample data generator — creates realistic test data for dashboard development.
 *
 * This is a development tool for iterating on the website without waiting for
 * the full data pipeline (which can take 10+ minutes due to NVD rate limits).
 * It generates synthetic but realistic vulnerability records and runs the
 * aggregation step.
 *
 * Usage: `npm run data:sample`
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRecord } from './pipeline/normalise.js';
import type { PipelineMeta, SourceId, VulnerabilityRecord } from './pipeline/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'src', 'data');
const RAW_DIR = join(DATA_DIR, 'raw');
const AGG_DIR = join(DATA_DIR, 'aggregated');

async function writeJson(path: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2) + '\n';
  await writeFile(path, json, 'utf-8');
}

// Simple seeded PRNG for reproducible data
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(42);

function randomInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randomDate(start: Date, end: Date): string {
  const timestamp = start.getTime() + rng() * (end.getTime() - start.getTime());
  return new Date(timestamp).toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Generate synthetic vulnerability records for a manufacturer. */
function generateRecords(
  manufacturer: string,
  source: SourceId,
  count: number,
  startDate: Date,
  endDate: Date,
): VulnerabilityRecord[] {
  const records: VulnerabilityRecord[] = [];
  const products: Record<string, string[]> = {
    Mozilla: ['Firefox', 'Thunderbird', 'Firefox ESR'],
    Google: ['Chrome', 'Android', 'Chrome OS'],
    Microsoft: ['Windows 11', 'Windows 10', 'Office 365', 'Edge', 'Exchange'],
    Apple: ['macOS', 'iOS', 'Safari', 'watchOS', 'iPadOS'],
    Oracle: ['Java', 'MySQL', 'Oracle Database', 'VirtualBox'],
    Samsung: ['Android', 'One UI', 'Knox'],
    Linux: ['Kernel', 'Ubuntu', 'Debian', 'RHEL'],
  };

  const productList = products[manufacturer] ?? ['Unknown'];

  for (let i = 0; i < count; i++) {
    const discoveredDate = randomDate(startDate, endDate);
    // Patch lag: 1-180 days, with a trend towards shorter lags in recent years
    const year = parseInt(discoveredDate.slice(0, 4));
    const baseLag = year >= 2024 ? randomInt(1, 90) : randomInt(7, 180);
    const patchedDate = rng() > 0.15 ? addDays(discoveredDate, baseLag) : undefined;

    const cvss = rng() > 0.3 ? Math.round(rng() * 10 * 10) / 10 : undefined;
    const cveId = `CVE-${year}-${randomInt(10000, 99999)}`;

    records.push(
      buildRecord({
        id: cveId,
        source,
        manufacturer,
        product: randomChoice(productList),
        title: `Vulnerability in ${randomChoice(productList)} — ${cveId}`,
        cvss,
        discoveredDate,
        patchedDate,
        cveIds: [cveId],
        rawUrl: `https://example.com/${source}/${cveId}`,
      }),
    );
  }

  return records;
}

async function main(): Promise<void> {
  console.log('=== VulnTrends sample data generator ===\n');

  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(AGG_DIR, { recursive: true });

  const startDate = new Date('2020-01-01');
  const endDate = new Date('2026-07-01');

  // Generate records per manufacturer
  const sourceCounts: Record<SourceId, number> = {
    mozilla: 0,
    chrome: 0,
    msrc: 0,
    apple: 0,
    projectzero: 0,
    nvd: 0,
  };

  const allRecords: VulnerabilityRecord[] = [];
  const sourceMap: Array<{ manufacturer: string; source: SourceId; count: number }> = [
    { manufacturer: 'Mozilla', source: 'mozilla', count: 200 },
    { manufacturer: 'Google', source: 'chrome', count: 350 },
    { manufacturer: 'Microsoft', source: 'msrc', count: 500 },
    { manufacturer: 'Apple', source: 'apple', count: 300 },
    { manufacturer: 'Google', source: 'projectzero', count: 150 },
    { manufacturer: 'Oracle', source: 'nvd', count: 200 },
    { manufacturer: 'Samsung', source: 'nvd', count: 100 },
    { manufacturer: 'Linux', source: 'nvd', count: 250 },
  ];

  for (const { manufacturer, source, count } of sourceMap) {
    console.log(`Generating ${count} records for ${manufacturer} (${source})...`);
    const records = generateRecords(manufacturer, source, count, startDate, endDate);
    sourceCounts[source] += records.length;
    allRecords.push(...records);
  }

  // Write per-source raw files
  for (const sourceId of Object.keys(sourceCounts) as SourceId[]) {
    const sourceRecords = allRecords.filter((r) => r.source === sourceId);
    await writeJson(join(RAW_DIR, `${sourceId}.json`), sourceRecords);
  }

  // Write merged file
  await writeJson(join(RAW_DIR, 'all.json'), allRecords);

  // Write metadata
  const meta: PipelineMeta = {
    lastUpdated: new Date().toISOString(),
    sourceCounts,
    totalRecords: allRecords.length,
  };
  await writeJson(join(DATA_DIR, 'meta.json'), meta);

  console.log(`\nGenerated ${allRecords.length} total records`);
  console.log('Running aggregation...');

}

main().then(async () => {
  // Run aggregation as a separate step
  const { execSync } = await import('node:child_process');
  console.log('\nRunning aggregation...');
  execSync('npx tsx scripts/aggregate.ts', { stdio: 'inherit', cwd: resolve(__dirname, '..') });
  console.log('\n=== Sample data generation complete ===');
}).catch((err) => {
  console.error('Sample data generation failed:', err);
  process.exit(1);
});
