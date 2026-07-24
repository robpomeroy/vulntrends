// One-off dedup-only runner.
//
// Re-runs just the dedup + aggregation steps against the existing
// raw files in src/data/raw/, without re-fetching. Used during
// development to iterate on the dedup logic without the slow NVD
// fetch (without an API key, NVD is rate-limited to ~1 req/6s).
//
// Reverted to the full `npm run data:build` once the dedup logic
// is stable.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  deduplicateByCve,
  deduplicateRecords,
} from './pipeline/normalise.js';
import type { VulnerabilityRecord } from './pipeline/types.js';

const RAW_DIR = 'src/data/raw';

async function loadSource(name) {
  const path = join(RAW_DIR, `${name}.json`);
  try {
    const txt = await readFile(path, 'utf-8');
    const parsed = JSON.parse(txt);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function main() {
  console.log('Loading per-source records...');
  const sources = [
    'mozilla', 'msrc', 'apple', 'chrome', 'pan', 'fortinet',
    'adobe', 'projectzero', 'cisco', 'osv', 'nvd',
  ];
  const all = [];
  for (const s of sources) {
    const records = await loadSource(s);
    console.log(`  ${s}: ${records.length} records`);
    all.push(...records);
  }
  console.log(`Total: ${all.length}`);

  console.log('\nDeduping (records + by CVE)...');
  const deduped = deduplicateByCve(deduplicateRecords(all));
  console.log(`After dedup: ${deduped.length}`);

  console.log('\nWriting all.json...');
  await writeFile(
    join(RAW_DIR, 'all.json'),
    JSON.stringify(deduped, null, 2) + '\n',
    'utf-8',
  );
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
