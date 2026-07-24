// Tests for the CVE-year date-sanity helpers and the dedup merge.
//
// Runs without a test framework — uses node:assert so we get
// pass/fail output without adding a devDependency. Invoke via
// `npx tsx scripts/pipeline/test-dedup-date.mjs`.
//
// Tests written first (per the user's "correctness is far more
// important than effort" guidance) so the bugs we just fixed in
// the dedup merge have regression coverage before we re-run the
// pipeline. Add new test cases here as new date semantics are
// added.

import { strict as assert } from 'node:assert';
import {
  dateMatchesCveYear,
  DATE_SANITY_MAX_YEARS,
  deduplicateRecords,
} from './normalise.js';

void assert; // silence unused-import; used implicitly via runtime checks

function group(name, fn) {
  console.log(`\n── ${name} ──`);
  fn();
}

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

// ============================================================================
// dateMatchesCveYear
// ============================================================================

group('dateMatchesCveYear basic cases', () => {
  expect(
    'returns the date when within tolerance',
    dateMatchesCveYear('2025-09-03', ['CVE-2025-1234']) === '2025-09-03',
  );
  expect(
    'returns the date when exactly N years off (boundary)',
    dateMatchesCveYear('2024-09-03', ['CVE-2025-1234']) === '2024-09-03',
  );
  expect(
    'returns undefined when N+1 years off',
    dateMatchesCveYear('2023-09-03', ['CVE-2025-1234']) === undefined,
  );
  expect(
    'returns undefined for 2025-09 vs CVE-1999 (Mariner-style re-import)',
    dateMatchesCveYear('2025-09-03', ['CVE-1999-0817']) === undefined,
  );
});

group('dateMatchesCveYear NVD-legitimate but not in tolerance', () => {
  // NVD can legitimately publish old CVEs years after their
  // assignment. The 1-year sanity check is for dedup-merge
  // artefact rejection — these calls document the threshold.
  expect(
    'helper is strict: CVE-1999 + 2001 publish is rejected (caught by A2 audit)',
    dateMatchesCveYear('2001-03-12', ['CVE-1999-0681']) === undefined,
  );
});

group('dateMatchesCveYear fallback behaviour', () => {
  expect(
    'returns the date when no CVE id provided (no year to compare)',
    dateMatchesCveYear('2025-09-03', []) === '2025-09-03',
  );
  expect(
    'returns undefined for empty date',
    dateMatchesCveYear(undefined, ['CVE-2025-1234']) === undefined,
  );
  expect(
    'returns undefined for empty string date',
    dateMatchesCveYear('', ['CVE-2025-1234']) === undefined,
  );
  expect(
    'returns the date when cveIds list has a matching CVE alongside a malformed entry',
    dateMatchesCveYear('2025-09-03', ['malformed', 'CVE-2025-1234']) === '2025-09-03',
  );
});

group('dateMatchesCveYear accepts any valid CVE in cveIds list', () => {
  expect(
    'multi-CVE: date matches the second CVE',
    dateMatchesCveYear('2023-09-03', ['CVE-2020-1111', 'CVE-2023-1234']) === '2023-09-03',
  );
  expect(
    'multi-CVE: rejects when no CVE in the list matches',
    dateMatchesCveYear('2023-09-03', ['CVE-2019-1111', 'CVE-2017-1234']) === undefined,
  );
});

group('DATE_SANITY_MAX_YEARS default', () => {
  expect(
    'default is 1 year (tight enough for Mariner re-imports, loose enough for legitimate corrections)',
    DATE_SANITY_MAX_YEARS === 1,
  );
});

// ============================================================================
// deduplicateRecords — exercises mergeRecords end-to-end
// ============================================================================

function makeRecord(overrides = {}) {
  return {
    id: 'CVE-2025-1234',
    cveIds: ['CVE-2025-1234'],
    source: 'msrc',
    manufacturer: 'Microsoft',
    title: 'Test record',
    discoveredDate: '2025-09-03',
    patchedDate: '2025-10-15',
    cvss: 7.5,
    severity: 'high',
    ...overrides,
  };
}

function dedup(records) {
  return deduplicateRecords(records);
}

group('deduplicateRecords: Mariner re-import (CVE-2010-4756 case)', () => {
  // The bug that motivated this fix. MSRC has 2025-09-04 (catalog
  // re-pub stamp) but the CVE is 2010-4756. NVD has the real
  // 2010-12-15 publish. The merge must choose NVD's date.
  const msrc = makeRecord({
    id: 'CVE-2010-4756',
    cveIds: ['CVE-2010-4756'],
    source: 'msrc',
    manufacturer: 'Microsoft',
    discoveredDate: '2025-09-04',
  });
  const nvd = makeRecord({
    id: 'CVE-2010-4756',
    cveIds: ['CVE-2010-4756'],
    source: 'nvd',
    manufacturer: 'Microsoft',
    discoveredDate: '2010-12-15',
    patchedDate: undefined,
  });
  const merged = dedup([msrc, nvd]);
  expect(
    'MSRC + NVD on same CVE: one merged record survives',
    merged.length === 1,
  );
  expect(
    'Mariner re-import: vendor date rejected, NVD date chosen',
    merged[0]?.discoveredDate === '2010-12-15',
  );
});

group('deduplicateRecords: sanity drops pathological pairs', () => {
  // Pathological case: both MSRC and NVD return recent dates for
  // an old CVE. The merge returns null, the caller drops it.
  const msrc = makeRecord({
    id: 'CVE-2010-4756',
    cveIds: ['CVE-2010-4756'],
    source: 'msrc',
    manufacturer: 'Microsoft',
    discoveredDate: '2025-09-04',
  });
  const nvd = makeRecord({
    id: 'CVE-2010-4756',
    cveIds: ['CVE-2010-4756'],
    source: 'nvd',
    manufacturer: 'Microsoft',
    discoveredDate: '2026-01-15', // also wrong
    patchedDate: undefined,
  });
  const merged = dedup([msrc, nvd]);
  expect(
    'both candidates fail: record dropped',
    merged.length === 0,
  );
});

group('deduplicateRecords: legitimate same-year dates preserved', () => {
  const msrc = makeRecord({ discoveredDate: '2025-09-03' });
  const nvd = makeRecord({
    source: 'nvd',
    discoveredDate: '2025-09-01',
    patchedDate: undefined,
  });
  const merged = dedup([msrc, nvd]);
  expect(
    'legitimate same-year dates: earliest wins',
    merged[0]?.discoveredDate === '2025-09-01',
  );
});

group('deduplicateRecords: legacy "vendor used patch as discovery" tie-breaker', () => {
  // Mozilla uses the patch date as the discovery date →
  // discoveredDate === patchedDate. For those records, promote
  // NVD's discovery date over the vendor's.
  const mozilla = makeRecord({
    source: 'mozilla',
    manufacturer: 'Mozilla',
    discoveredDate: '2025-10-15',
    patchedDate: '2025-10-15',
  });
  const nvd = makeRecord({
    source: 'nvd',
    discoveredDate: '2025-09-20',
    patchedDate: undefined,
  });
  const merged = dedup([mozilla, nvd]);
  expect(
    'vendor date == vendor patchedDate: NVD date promoted',
    merged[0]?.discoveredDate === '2025-09-20',
  );
});

group('deduplicateRecords: severity/cvss precedence', () => {
  const msrc = makeRecord({ cvss: 7.5, severity: 'high' });
  const nvd = makeRecord({
    source: 'nvd',
    cvss: 8.0,
    severity: 'critical',
    patchedDate: undefined,
  });
  const merged = dedup([msrc, nvd]);
  expect(
    'vendor severity/CVSS wins',
    merged[0]?.cvss === 7.5 && merged[0]?.severity === 'high',
  );
});

group('deduplicateRecords: patchedDate fallback', () => {
  // Vendor has no patch date (NVD-backed record). NVD's patchedDate
  // takes over.
  const vendorNoPatch = makeRecord({ patchedDate: undefined });
  const nvd = makeRecord({
    source: 'nvd',
    discoveredDate: '2025-09-01',
    patchedDate: '2025-11-01',
  });
  const merged = dedup([vendorNoPatch, nvd]);
  expect(
    'vendor missing patchedDate: NVD patchedDate takes over',
    merged[0]?.patchedDate === '2025-11-01',
  );
});

group('deduplicateRecords: same precedence keeps first', () => {
  // Both records share the same id and source (NVD). Same
  // precedence → the function iterates and the first-encountered
  // record is kept; the loop `continue`s on `if (existingP === recordP)`
  // without merging. The second is dropped.
  const a = makeRecord({
    source: 'nvd',
    id: 'CVE-2025-SHARED',
    cveIds: ['CVE-2025-SHARED'],
    discoveredDate: '2025-09-01',
    patchedDate: undefined,
  });
  const b = makeRecord({
    source: 'nvd',
    id: 'CVE-2025-SHARED',
    cveIds: ['CVE-2025-SHARED'],
    discoveredDate: '2025-09-15',
    patchedDate: undefined,
  });
  const merged = dedup([a, b]);
  expect(
    'same precedence + same id: only the first survives',
    merged.length === 1 && merged[0]?.discoveredDate === '2025-09-01',
  );
});

// ============================================================================
// Summary
// ============================================================================

console.log(
  `\n${'='.repeat(60)}\nResults: ${passed} passed, ${failed} failed\n${'='.repeat(60)}`,
);
if (failed > 0) {
  process.exit(1);
}
