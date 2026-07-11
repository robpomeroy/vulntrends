/**
 * Pipeline orchestrator.
 *
 * Runs all data source parsers, merges results, deduplicates by CVE ID
 * (preferring vendor-specific data over NVD for timing), and writes
 * normalised records to `src/data/raw/<source>.json`.
 *
 * Also writes `src/data/meta.json` with pipeline metadata.
 *
 * Usage: `npm run data:build` (runs this then aggregate.ts)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { deduplicateByCve, deduplicateRecords } from './normalise.js';
import type { PipelineMeta, SourceId, VulnerabilityRecord } from './types.js';

import { fetchRecords as fetchMozilla } from './sources/mozilla.js';
import { fetchRecords as fetchMsrc } from './sources/msrc.js';
import { fetchRecords as fetchProjectZero } from './sources/projectzero.js';
import { fetchRecords as fetchNvd } from './sources/nvd.js';
import { fetchRecords as fetchChrome } from './sources/chrome.js';
import { fetchRecords as fetchApple } from './sources/apple.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', '..', 'src', 'data');
const RAW_DIR = join(DATA_DIR, 'raw');

/** All data sources, in fetch order. NVD is last so it can fill gaps. */
const SOURCES: Array<{ id: SourceId; fetch: () => Promise<VulnerabilityRecord[]> }> = [
  { id: 'mozilla', fetch: fetchMozilla },
  { id: 'msrc', fetch: fetchMsrc },
  { id: 'projectzero', fetch: fetchProjectZero },
  { id: 'chrome', fetch: fetchChrome },
  { id: 'apple', fetch: fetchApple },
  { id: 'nvd', fetch: fetchNvd },
];

async function writeJson(path: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2) + '\n';
  await writeFile(path, json, 'utf-8');
}

async function main(): Promise<void> {
  console.log('=== VulnTrends data pipeline ===\n');

  // Ensure output directories exist
  await mkdir(RAW_DIR, { recursive: true });

  const sourceCounts: Record<SourceId, number> = {
    mozilla: 0,
    chrome: 0,
    msrc: 0,
    apple: 0,
    projectzero: 0,
    nvd: 0,
  };

  const allRecords: VulnerabilityRecord[] = [];

  // Fetch each source
  for (const source of SOURCES) {
    console.log(`\n--- ${source.id} ---`);
    try {
      const records = await source.fetch();
      sourceCounts[source.id] = records.length;
      allRecords.push(...records);

      // Write per-source raw JSON
      await writeJson(join(RAW_DIR, `${source.id}.json`), records);
      console.log(`  Written ${records.length} records to raw/${source.id}.json`);
    } catch (err) {
      console.error(`  ERROR fetching ${source.id}:`, err);
      sourceCounts[source.id] = 0;
      // Write empty array so the file exists
      await writeJson(join(RAW_DIR, `${source.id}.json`), []);
    }
  }

  // Deduplicate — first by record ID, then by CVE ID
  console.log('\n=== Deduplication ===');
  console.log(`Total records before dedup: ${allRecords.length}`);
  const deduped = deduplicateByCve(deduplicateRecords(allRecords));
  console.log(`Total records after dedup: ${deduped.length}`);

  // Write merged raw file
  await writeJson(join(RAW_DIR, 'all.json'), deduped);

  // Write metadata
  const meta: PipelineMeta = {
    lastUpdated: new Date().toISOString(),
    sourceCounts,
    totalRecords: deduped.length,
  };
  await writeJson(join(DATA_DIR, 'meta.json'), meta);

  console.log('\n=== Pipeline complete ===');
  console.log(`Meta written to src/data/meta.json`);
  console.log(`Raw records written to src/data/raw/`);
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
