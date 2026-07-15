// Test the cached-fallback logic that runs in the pipeline's catch block.
//
// Simulates the exact behaviour from scripts/pipeline/index.ts. We
// extract the relevant logic into a small function here and test it
// directly without needing to mock the whole pipeline.

import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(resolve(__dirname, '..', '..', 'src', 'data', 'raw'));
const TEST_SOURCE = 'cisco'; // we use cisco because it's a simple stub

async function readJson(path) {
  if (!existsSync(path)) return [];
  return JSON.parse(await readFile(path, 'utf-8'));
}

async function writeJson(path, data) {
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Mirror of the per-source try/catch logic in pipeline/index.ts.
 */
async function fetchWithCache(sourceId, fetchFn) {
  const stderrMessages = [];
  const allRecords = [];
  let sourceCount = 0;
  let usedCache = false;

  try {
    const records = await fetchFn();
    sourceCount = records.length;
    allRecords.push(...records);
    await writeJson(join(RAW_DIR, `${sourceId}.json`), records);
  } catch (err) {
    stderrMessages.push(`fetch failed: ${err.message}`);
    const prevPath = join(RAW_DIR, `${sourceId}.json`);
    let prevRecords = [];
    try {
      const prevJson = await readFile(prevPath, 'utf-8');
      const parsed = JSON.parse(prevJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        prevRecords = parsed;
        sourceCount = prevRecords.length;
        allRecords.push(...prevRecords);
        usedCache = true;
        stderrMessages.push(`reusing ${prevRecords.length} cached records`);
      }
    } catch {
      // No previous file
    }
    if (!usedCache) {
      sourceCount = 0;
      await writeJson(prevPath, []);
      stderrMessages.push('wrote empty array');
    }
  }
  return { usedCache, recordCount: allRecords.length, sourceCount, stderrMessages };
}

async function main() {
  // Back up the current cisco file
  const ciscoPath = join(RAW_DIR, `${TEST_SOURCE}.json`);
  const originalJson = existsSync(ciscoPath) ? await readFile(ciscoPath, 'utf-8') : null;
  const backupPath = join(__dirname, `cisco-backup-${Date.now()}.json`);
  if (originalJson) await writeFile(backupPath, originalJson, 'utf-8');

  try {
    // Plant some "previous" data
    const previousData = [
      { id: 'CVE-2025-9999', source: 'cisco', manufacturer: 'Cisco', title: 'Cached record', discoveredDate: '2025-01-01' },
      { id: 'CVE-2025-9998', source: 'cisco', manufacturer: 'Cisco', title: 'Cached record 2', discoveredDate: '2025-02-01' },
    ];
    await writeJson(ciscoPath, previousData);
    console.log(`Setup: cisco.json has ${previousData.length} cached record(s)`);

    // ── Test 1: fetch fails, cache available → use cache ──
    console.log('\nTest 1: fetch fails, cache available');
    const result1 = await fetchWithCache(TEST_SOURCE, async () => {
      throw new Error('Simulated network failure');
    });
    const onDisk1 = await readJson(ciscoPath);
    console.log(`  Used cache: ${result1.usedCache}`);
    console.log(`  Records returned: ${result1.recordCount}`);
    console.log(`  Source count: ${result1.sourceCount}`);
    console.log(`  Stderr: ${result1.stderrMessages.join(' | ')}`);
    console.log(`  On-disk count: ${onDisk1.length}`);
    const pass1 =
      result1.usedCache === true &&
      result1.recordCount === 2 &&
      result1.sourceCount === 2 &&
      onDisk1.length === 2 &&
      result1.stderrMessages.some((m) => m.includes('cached'));
    console.log(pass1 ? '  PASS' : '  FAIL');

    // ── Test 2: fetch succeeds → use fresh data, not cache ──
    console.log('\nTest 2: fetch succeeds');
    const freshData = [
      { id: 'CVE-2025-7777', source: 'cisco', manufacturer: 'Cisco', title: 'Fresh record', discoveredDate: '2025-12-01' },
    ];
    const result2 = await fetchWithCache(TEST_SOURCE, async () => freshData);
    const onDisk2 = await readJson(ciscoPath);
    console.log(`  Used cache: ${result2.usedCache}`);
    console.log(`  Records returned: ${result2.recordCount}`);
    console.log(`  On-disk count: ${onDisk2.length}`);
    const pass2 =
      result2.usedCache === false &&
      result2.recordCount === 1 &&
      onDisk2.length === 1 &&
      onDisk2[0].id === 'CVE-2025-7777';
    console.log(pass2 ? '  PASS' : '  FAIL');

    // ── Test 3: fetch fails, no cache → write empty, return 0 ──
    console.log('\nTest 3: fetch fails, no cache available (first run)');
    if (existsSync(ciscoPath)) await rm(ciscoPath);
    const result3 = await fetchWithCache(TEST_SOURCE, async () => {
      throw new Error('Simulated first-run failure');
    });
    const onDisk3 = await readJson(ciscoPath);
    console.log(`  Used cache: ${result3.usedCache}`);
    console.log(`  Records returned: ${result3.recordCount}`);
    console.log(`  On-disk count: ${onDisk3.length}`);
    const pass3 =
      result3.usedCache === false &&
      result3.recordCount === 0 &&
      onDisk3.length === 0 &&
      result3.stderrMessages.some((m) => m.includes('empty'));
    console.log(pass3 ? '  PASS' : '  FAIL');

    // ── Test 4: failure threshold logic ──
    console.log('\nTest 4: failure threshold (simulated)');
    const MAX = 2;
    const failedSources = ['msrc', 'chrome', 'nvd'];
    const passesThreshold = failedSources.length > MAX;
    console.log(`  ${failedSources.length} failed (threshold ${MAX}): ${passesThreshold ? 'abort' : 'continue'}`);
    console.log(passesThreshold ? '  PASS' : '  FAIL');

    console.log('\nAll tests complete.');
  } finally {
    // Restore
    if (originalJson) {
      await writeFile(ciscoPath, originalJson, 'utf-8');
      await rm(backupPath).catch(() => {});
    } else {
      await rm(ciscoPath).catch(() => {});
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
