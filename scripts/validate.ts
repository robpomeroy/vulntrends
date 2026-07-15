/**
 * Data validation script.
 *
 * Loads all generated JSON files in `src/data/` and validates them against
 * the Zod schemas defined in `src/lib/schema.ts`.
 *
 * Usage: `npm run data:validate`
 */

import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  backlogPointArraySchema,
  manufacturerInfoArraySchema,
  patchLagPointArraySchema,
  pipelineMetaSchema,
  timeSeriesPointArraySchema,
  vulnerabilityRecordArraySchema,
} from '../src/lib/schema.js';
import type { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'src', 'data');
const RAW_DIR = join(DATA_DIR, 'raw');
const AGG_DIR = join(DATA_DIR, 'aggregated');

async function readJson(path: string): Promise<unknown> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content);
}

interface ValidationTask {
  label: string;
  path: string;
  schema: z.ZodType;
}

const tasks: ValidationTask[] = [
  // Raw records
  { label: 'raw/mozilla.json', path: join(RAW_DIR, 'mozilla.json'), schema: vulnerabilityRecordArraySchema },
  { label: 'raw/chrome.json', path: join(RAW_DIR, 'chrome.json'), schema: vulnerabilityRecordArraySchema },
  { label: 'raw/msrc.json', path: join(RAW_DIR, 'msrc.json'), schema: vulnerabilityRecordArraySchema },
  { label: 'raw/apple.json', path: join(RAW_DIR, 'apple.json'), schema: vulnerabilityRecordArraySchema },
  { label: 'raw/projectzero.json', path: join(RAW_DIR, 'projectzero.json'), schema: vulnerabilityRecordArraySchema },
  { label: 'raw/pan.json', path: join(RAW_DIR, 'pan.json'), schema: vulnerabilityRecordArraySchema },
  { label: 'raw/fortinet.json', path: join(RAW_DIR, 'fortinet.json'), schema: vulnerabilityRecordArraySchema },
  { label: 'raw/cisco.json', path: join(RAW_DIR, 'cisco.json'), schema: vulnerabilityRecordArraySchema },
  { label: 'raw/adobe.json', path: join(RAW_DIR, 'adobe.json'), schema: vulnerabilityRecordArraySchema },
  { label: 'raw/nvd.json', path: join(RAW_DIR, 'nvd.json'), schema: vulnerabilityRecordArraySchema },
  { label: 'raw/all.json', path: join(RAW_DIR, 'all.json'), schema: vulnerabilityRecordArraySchema },
  // Meta
  { label: 'meta.json', path: join(DATA_DIR, 'meta.json'), schema: pipelineMetaSchema },
  // Aggregated
  { label: 'aggregated/discovered-by-month.json', path: join(AGG_DIR, 'discovered-by-month.json'), schema: timeSeriesPointArraySchema },
  { label: 'aggregated/fixed-by-month.json', path: join(AGG_DIR, 'fixed-by-month.json'), schema: timeSeriesPointArraySchema },
  { label: 'aggregated/patch-lag-by-month.json', path: join(AGG_DIR, 'patch-lag-by-month.json'), schema: patchLagPointArraySchema },
  { label: 'aggregated/backlog-by-month.json', path: join(AGG_DIR, 'backlog-by-month.json'), schema: backlogPointArraySchema },
  { label: 'aggregated/discovered-by-year.json', path: join(AGG_DIR, 'discovered-by-year.json'), schema: timeSeriesPointArraySchema },
  { label: 'aggregated/fixed-by-year.json', path: join(AGG_DIR, 'fixed-by-year.json'), schema: timeSeriesPointArraySchema },
  { label: 'aggregated/patch-lag-by-year.json', path: join(AGG_DIR, 'patch-lag-by-year.json'), schema: patchLagPointArraySchema },
  { label: 'aggregated/backlog-by-year.json', path: join(AGG_DIR, 'backlog-by-year.json'), schema: backlogPointArraySchema },
  { label: 'aggregated/manufacturers.json', path: join(AGG_DIR, 'manufacturers.json'), schema: manufacturerInfoArraySchema },
];

async function main(): Promise<void> {
  console.log('=== VulnTrends data validation ===\n');

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const task of tasks) {
    try {
      const data = await readJson(task.path);
      const result = task.schema.safeParse(data);
      if (result.success) {
        console.log(`  ✓ ${task.label}`);
        passed++;
      } else {
        console.error(`  ✗ ${task.label}`);
        for (const issue of result.error!.issues) {
          console.error(`    ${issue.path.join('.')}: ${issue.message}`);
        }
        failed++;
      }
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        console.log(`  - ${task.label} (file not found, skipped)`);
        skipped++;
      } else {
        console.error(`  ✗ ${task.label} — read error:`, err);
        failed++;
      }
    }
  }

  console.log(`\n=== Validation complete ===`);
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
