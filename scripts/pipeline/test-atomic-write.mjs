// Tests for the shared atomic JSON writer (`writeJsonAtomic`).
//
// Runs without a test framework — prints pass/fail output and exits non-zero
// on failure without adding a devDependency. Invoke via
// `npx tsx scripts/pipeline/test-atomic-write.mjs`.
//
// `writeJsonAtomic` is a pipeline-critical primitive: it writes output
// files temp-then-rename so a timed-out `data:build` (which publish treats
// as non-fatal) can never leave a partially-written JSON file on disk.
// These tests guard the cross-platform edge cases that would otherwise
// silently break publishes — creating missing directories, overwriting an
// existing file, and not leaving a `.*.tmp` file behind on success.

import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic } from './atomic-write.js';

let passed = 0;
let failed = 0;
function expect(label, condition) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

// Each test uses a fresh temp dir so leftover `.tmp` files (a regression
// signal) are attributable to a single case.
async function inTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'vt-atomic-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

try {
  await inTempDir(async (dir) => {
    console.log('Test 1: creates missing directories');
    const nested = join(dir, 'sub', 'deep', 'data.json');
    await writeJsonAtomic(nested, { hello: 'world' });
    const content = JSON.parse(await readFile(nested, 'utf-8'));
    expect('file written with correct content', content.hello === 'world');
  });

  await inTempDir(async (dir) => {
    console.log('Test 2: overwrites an existing file atomically');
    const file = join(dir, 'data.json');
    await writeJsonAtomic(file, { version: 1 });
    await writeJsonAtomic(file, { version: 2 });
    const content = JSON.parse(await readFile(file, 'utf-8'));
    expect('overwrite reflects the new content', content.version === 2);
  });

  await inTempDir(async (dir) => {
    console.log('Test 3: leaves no .tmp file behind on success');
    const file = join(dir, 'data.json');
    await writeJsonAtomic(file, { n: 1 });
    const entries = await readdir(dir);
    expect('no .tmp file remains', entries.every((e) => !e.endsWith('.tmp')));
  });

  await inTempDir(async (dir) => {
    console.log('Test 4: cleans up the .tmp file when rename fails');
    // Make the destination a directory so `rename(tmp, path)` fails, then
    // assert the temp file was removed on the error path.
    const dest = join(dir, 'data.json');
    await rm(dest, { force: true });
    await mkdir(dest, { recursive: true });
    let threw = false;
    try {
      await writeJsonAtomic(dest, { n: 1 });
    } catch {
      threw = true;
    }
    const entries = await readdir(dir);
    expect('rename failure propagates', threw);
    expect('no .tmp file remains after failure', entries.every((e) => !e.endsWith('.tmp')));
  });

  // Assert the helper still works via `expect` so the import itself is
  // loader-verified (the checks above already cover behaviour).
  expect('imports load and helper is a function', typeof writeJsonAtomic === 'function');
} catch (err) {
  failed++;
  console.error(`  ✗ uncaught error: ${err}`);
}

console.log(`\n${'='.repeat(60)}\nResults: ${passed} passed, ${failed} failed\n${'='.repeat(60)}`);
if (failed > 0) {
  process.exit(1);
}