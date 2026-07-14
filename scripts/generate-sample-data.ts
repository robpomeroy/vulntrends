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
    'Palo Alto': ['PAN-OS', 'Prisma Access', 'GlobalProtect', 'Cortex XDR'],
    Fortinet: ['FortiOS', 'FortiProxy', 'FortiManager', 'FortiAnalyzer', 'FortiMail'],
    Cisco: ['IOS XE', 'IOS', 'NX-OS', 'Webex', 'Umbrella', 'Firepower'],
    Adobe: ['Acrobat', 'Reader', 'Photoshop', 'ColdFusion', 'Experience Manager'],
  };

  const productList = products[manufacturer] ?? ['Unknown'];

  for (let i = 0; i < count; i++) {
    const discoveredDate = randomDate(startDate, endDate);
    // Patch lag: 1-180 days, with a trend towards shorter lags in recent years
    const year = parseInt(discoveredDate.slice(0, 4));
    const baseLag = year >= 2024 ? randomInt(1, 90) : randomInt(7, 180);
    let patchedDate = rng() > 0.15 ? addDays(discoveredDate, baseLag) : undefined;
    if (patchedDate && new Date(patchedDate) > endDate) patchedDate = undefined;

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
    pan: 0,
    fortinet: 0,
    cisco: 0,
    adobe: 0,
    nvd: 0,
  };

  const allRecords: VulnerabilityRecord[] = [];
  const sourceMap: Array<{ manufacturer: string; source: SourceId; count: number }> = [
    { manufacturer: 'Mozilla', source: 'mozilla', count: 200 },
    { manufacturer: 'Google', source: 'chrome', count: 350 },
    { manufacturer: 'Microsoft', source: 'msrc', count: 500 },
    { manufacturer: 'Apple', source: 'apple', count: 300 },
    { manufacturer: 'Google', source: 'projectzero', count: 150 },
    { manufacturer: 'Palo Alto', source: 'pan', count: 200 },
    { manufacturer: 'Fortinet', source: 'fortinet', count: 180 },
    { manufacturer: 'Cisco', source: 'cisco', count: 220 },
    { manufacturer: 'Adobe', source: 'adobe', count: 160 },
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

  // Generate NVD "discovery" records for a subset of vendor CVEs.
  // In real data, NVD has a `published` date (proxy for discovery) that is
  // earlier than the vendor's patch date. The deduplication merge logic
  // combines these to produce a real patch lag.
  console.log('Generating NVD discovery records for vendor CVEs...');
  const vendorRecords = allRecords.filter(
    (r) => r.source !== 'nvd' && r.cveIds && r.cveIds.length > 0,
  );
  const nvdDiscoveryRecords: VulnerabilityRecord[] = [];
  for (const vr of vendorRecords) {
    // Generate an NVD record for ~60% of vendor CVEs
    if (rng() > 0.6) continue;
    if (!vr.discoveredDate || !vr.patchedDate) continue;
    // NVD published date is 1-30 days before the vendor's patch date
    // (simulating the gap between CVE publication and vendor patch release)
    const lagDays = randomInt(1, 30);
    const nvdDate = addDays(vr.patchedDate, -lagDays);
    // Only use the NVD date if it's before the vendor's date
    if (new Date(nvdDate) > new Date(vr.patchedDate)) continue;
    nvdDiscoveryRecords.push(
      buildRecord({
        id: vr.id,
        source: 'nvd',
        manufacturer: vr.manufacturer,
        title: vr.title,
        discoveredDate: nvdDate,
        // NVD records don't have patchedDate — the merge will take it
        // from the vendor record
        cveIds: vr.cveIds,
        rawUrl: `https://nvd.nist.gov/vuln/detail/${vr.id}`,
      }),
    );
  }
  sourceCounts.nvd += nvdDiscoveryRecords.length;
  allRecords.push(...nvdDiscoveryRecords);
  console.log(`  Generated ${nvdDiscoveryRecords.length} NVD discovery records`);

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
