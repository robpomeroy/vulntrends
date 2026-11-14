// Unit tests for Linux Kernel, Red Hat, and Ubuntu OSV parsers
// Verifies fix handling, earliest patch date selection, and avoidance of fabricated patch lags.

import { deflateRawSync } from 'node:zlib';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { osvToRecord, parseLinuxVulns, fetchRecords as fetchLinuxRecords } from './sources/linux.js';
import { parseRedHatVulns, fetchRecords as fetchRedHatRecords } from './sources/redhat.js';
import { parseUbuntuVulns, fetchRecords as fetchUbuntuRecords } from './sources/ubuntu.js';
import {
  collectOsvCveIds,
  inferManufacturer,
  formatOsvTitle,
  extractCvss,
  fetchRecords as fetchOsvRecords,
} from './sources/osv.js';
import { hasVulnerableOsMatch, cveToRecord, fetchRecords as fetchNvdRecords, fetchCvePage } from './sources/nvd.js';

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

async function group(name, fn) {
  console.log(`\n── ${name} ──`);
  await fn();
}

// 1. Linux Kernel: OSV metadata timestamps must not be used as patch dates
group('Linux Kernel OSV parser', () => {
  const vuln = {
    id: 'CVE-2024-99999',
    summary: 'Buffer overflow in net/core/skbuff.c',
    published: '2024-03-01T12:00:00Z',
    modified: '2024-03-15T18:00:00Z',
    affected: [
      {
        package: { name: 'Kernel', ecosystem: 'Linux' },
        ranges: [
          {
            type: 'GIT',
            repo: 'https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git',
            events: [
              { introduced: '0' },
              { fixed: 'abcdef1234567890abcdef1234567890abcdef12' },
            ],
          },
        ],
      },
    ],
  };

  const rec = osvToRecord(vuln);
  expect('record is successfully parsed', rec !== null);
  expect('discoveredDate is derived from published', rec?.discoveredDate === '2024-03-01');
  expect('patchedDate is undefined (not set to modified)', rec?.patchedDate === undefined);

  // Normalise lowercase CVE ID aliases to uppercase
  const lowercaseVuln = {
    id: 'cve-2024-4444',
    aliases: ['cve-2024-4444'],
    summary: 'Lowercase CVE id test',
    published: '2024-03-01T12:00:00Z',
  };
  const recLower = osvToRecord(lowercaseVuln);
  expect('lowercase CVE ID is canonicalised to uppercase', recLower?.id === 'CVE-2024-4444');
  expect('cveIds contains uppercase CVE ID', recLower?.cveIds[0] === 'CVE-2024-4444');

  // Skip withdrawn Linux records
  const withdrawnVuln = {
    id: 'CVE-2024-8888',
    summary: 'Withdrawn entry',
    published: '2024-03-01T12:00:00Z',
    withdrawn: '2024-03-10T12:00:00Z',
  };
  expect('withdrawn Linux record is skipped', osvToRecord(withdrawnVuln) === null);
});

// 2. Red Hat: Retains earliest RHSA patch release date when multiple advisories resolve the same CVE
group('Red Hat OSV parser: earliest patch date selection and upstream CVEs', () => {
  // Pass later advisory first, then earlier advisory
  const laterAdvisory = {
    id: 'RHSA-2024:5000',
    summary: 'RHEL 9 update for CVE-2024-1111',
    published: '2024-05-10T10:00:00Z',
    related: ['CVE-2024-1111'],
  };

  const earlierAdvisory = {
    id: 'RHSA-2024:1000',
    summary: 'RHEL 8 initial fix for CVE-2024-1111',
    published: '2024-02-15T10:00:00Z',
    related: ['CVE-2024-1111'],
  };

  const records = parseRedHatVulns([laterAdvisory, earlierAdvisory]);
  const cveRec = records.find((r) => r.id === 'CVE-2024-1111');

  expect('single record retained for CVE', records.filter((r) => r.id === 'CVE-2024-1111').length === 1);
  expect('earliest patch date 2024-02-15 is retained', cveRec?.patchedDate === '2024-02-15');

  // Extract CVEs from upstream
  const upstreamAdvisory = {
    id: 'RHSA-2026:66401',
    summary: 'Go advisory with upstream CVE',
    published: '2026-01-15T10:00:00Z',
    upstream: ['CVE-2026-9876'],
  };
  const upstreamRecs = parseRedHatVulns([upstreamAdvisory]);
  const upstreamCve = upstreamRecs.find((r) => r.id === 'CVE-2026-9876');
  expect('upstream CVE identifier is extracted', upstreamCve !== undefined);
  expect('upstream CVE record has RHSA patch date', upstreamCve?.patchedDate === '2026-01-15');

  // Skip withdrawn Red Hat records
  const withdrawnAdvisory = {
    id: 'RHSA-2024:9999',
    summary: 'Withdrawn RHSA',
    published: '2024-01-01T10:00:00Z',
    withdrawn: '2024-01-10T10:00:00Z',
    related: ['CVE-2024-9991'],
  };
  const withdrawnRecs = parseRedHatVulns([withdrawnAdvisory]);
  expect('withdrawn RHSA record is skipped', withdrawnRecs.length === 0);
});

// 3. Ubuntu: Retains earliest USN notice date when multiple USNs resolve the same CVE
group('Ubuntu OSV parser: earliest USN notice date selection', () => {
  // Pass USN point update first (later date), then original USN notice (earlier date)
  const laterUsn = {
    id: 'USN-6000-2',
    summary: 'Ubuntu 22.04 regression update',
    published: '2024-04-20T10:00:00Z',
    aliases: ['CVE-2024-2222'],
  };

  const earlierUsn = {
    id: 'USN-6000-1',
    summary: 'Ubuntu initial security notice',
    published: '2024-03-05T10:00:00Z',
    aliases: ['CVE-2024-2222'],
  };

  const records = parseUbuntuVulns([laterUsn, earlierUsn]);
  const cveRec = records.find((r) => r.id === 'CVE-2024-2222');

  expect('single record retained for CVE across USNs', records.filter((r) => r.id === 'CVE-2024-2222').length === 1);
  expect('earliest notice date 2024-03-05 is retained', cveRec?.patchedDate === '2024-03-05');
});

// 4. Ubuntu: Standalone non-USN CVEs must leave patchedDate undefined
group('Ubuntu OSV parser: non-USN standalone tracking records', () => {
  const standaloneCve = {
    id: 'UBUNTU-CVE-2024-3333',
    summary: 'Standalone tracking record in Ubuntu',
    published: '2024-01-10T10:00:00Z',
    modified: '2024-06-01T15:00:00Z',
    affected: [
      {
        package: { name: 'curl', ecosystem: 'Ubuntu' },
        ranges: [
          {
            events: [{ introduced: '0' }, { fixed: '8.5.0-1ubuntu1' }],
          },
        ],
      },
    ],
  };

  const records = parseUbuntuVulns([standaloneCve]);
  const rec = records.find((r) => r.id === 'CVE-2024-3333');

  expect('standalone record is parsed', rec !== undefined);
  expect('discoveredDate is parsed correctly', rec?.discoveredDate === '2024-01-10');
  expect('patchedDate is undefined (not set to modified)', rec?.patchedDate === undefined);

  // Standalone record with lowercase CVE alias is canonicalised to uppercase
  const lowercaseStandalone = {
    id: 'UBUNTU-cve-2024-5555',
    aliases: ['cve-2024-5555'],
    summary: 'Lowercase standalone CVE',
    published: '2024-02-01T10:00:00Z',
  };
  const recsLower = parseUbuntuVulns([lowercaseStandalone]);
  const recLower = recsLower.find((r) => r.id === 'CVE-2024-5555');
  expect('lowercase standalone CVE is canonicalised to uppercase', recLower !== undefined && recLower.id === 'CVE-2024-5555');

  // Standalone record followed later by a USN for the same CVE: USN takes precedence
  // and earlier discovery date is merged into USN record with patchLagDays recalculated
  const standaloneBeforeUsn = {
    id: 'UBUNTU-CVE-2024-7777',
    aliases: ['cve-2024-7777'],
    summary: 'Earlier standalone entry',
    published: '2024-03-01T10:00:00Z',
  };
  const laterUsnForSameCve = {
    id: 'USN-7000-1',
    summary: 'USN notice resolving CVE-2024-7777',
    published: '2024-03-15T10:00:00Z',
    aliases: ['CVE-2024-7777'],
  };
  const orderTestRecs = parseUbuntuVulns([standaloneBeforeUsn, laterUsnForSameCve]);
  const matched = orderTestRecs.filter((r) => r.id === 'CVE-2024-7777');
  expect('only USN record survives when standalone is seen first', matched.length === 1);
  expect('surviving record has USN patch date', matched[0]?.patchedDate === '2024-03-15');
  expect('surviving record merged earlier discovery date', matched[0]?.discoveredDate === '2024-03-01');
  expect('patchLagDays recomputed correctly (14 days)', matched[0]?.patchLagDays === 14);

  // USN with per-CVE severity in cves_map
  const usnWithPerCveCvss = {
    id: 'USN-7648-1',
    summary: 'Notice without top-level severity',
    published: '2024-07-17T10:00:00Z',
    affected: [
      {
        package: { name: 'bind9', ecosystem: 'Ubuntu' },
        database_specific: {
          cves_map: {
            cves: [
              {
                id: 'CVE-2024-1234',
                severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
              },
            ],
          },
        },
      },
    ],
  };
  const usnCvssRecs = parseUbuntuVulns([usnWithPerCveCvss]);
  const usnCvssRec = usnCvssRecs.find((r) => r.id === 'CVE-2024-1234');
  expect('per-CVE severity extracted from cves_map', usnCvssRec?.cvss === 9.8);

  // Skip withdrawn Ubuntu records
  const withdrawnUsn = {
    id: 'USN-9999-1',
    summary: 'Withdrawn USN',
    published: '2024-01-01T10:00:00Z',
    withdrawn: '2024-01-05T10:00:00Z',
    aliases: ['CVE-2024-9992'],
  };
  const withdrawnUbuntuRecs = parseUbuntuVulns([withdrawnUsn]);
  expect('withdrawn USN is skipped', withdrawnUbuntuRecs.length === 0);
});

// 5. OSV: Prioritise explicit ecosystems over text matches in inferManufacturer
group('OSV inferManufacturer ecosystem prioritization', () => {
  const distroKernelAdvisory = {
    id: 'USN-3654-2',
    summary: 'Linux kernel vulnerability in Ubuntu 22.04',
    details: 'Several security issues were fixed in the Linux kernel.',
    affected: [
      {
        package: { name: 'linux', ecosystem: 'Ubuntu:22.04:LTS' },
      },
    ],
  };
  expect(
    'Ubuntu ecosystem takes precedence over "linux kernel" text',
    inferManufacturer(distroKernelAdvisory, 'CVE-2024-1000') === 'Ubuntu',
  );

  const rhelKernelAdvisory = {
    id: 'RHSA-2024:1234',
    summary: 'kernel security update for RHEL 9',
    details: 'The linux kernel package has been updated.',
    affected: [
      {
        package: { name: 'kernel', ecosystem: 'Red Hat:enterprise_linux:9' },
      },
    ],
  };
  expect(
    'Red Hat ecosystem takes precedence over "linux kernel" text',
    inferManufacturer(rhelKernelAdvisory, 'CVE-2024-2000') === 'Red Hat',
  );

  const upstreamLinuxOsv = {
    id: 'CVE-2024-3000',
    summary: 'Kernel bug',
    affected: [
      {
        package: { name: 'Kernel', ecosystem: 'Linux' },
      },
    ],
  };
  expect(
    'Linux ecosystem maps to Linux',
    inferManufacturer(upstreamLinuxOsv, 'CVE-2024-3000') === 'Linux',
  );

  const multiAffectedOsv = {
    id: 'CVE-2024-3001',
    summary: 'Multi-affected bug',
    affected: [
      { package: { name: 'unrelated', ecosystem: 'PyPI' } },
      { package: { name: 'core', ecosystem: 'Ubuntu:22.04:LTS' } },
    ],
  };
  expect(
    'inferManufacturer scans all affected entries for ecosystem match',
    inferManufacturer(multiAffectedOsv, 'CVE-2024-3001') === 'Ubuntu',
  );
});

// 6. formatOsvTitle: validates truncation to 200 chars and fallbacks
group('formatOsvTitle helper', () => {
  const longSummary = 'A'.repeat(300);
  const formattedLong = formatOsvTitle(longSummary, undefined, 'CVE-2024-0001', 'Fallback');
  expect('truncates titles to 200 chars max', formattedLong.length === 200);

  const multiLineDetails = 'First line summary\nSecond line extra detail\nThird line';
  const fromDetails = formatOsvTitle(undefined, multiLineDetails, 'CVE-2024-0002', 'Fallback');
  expect('uses first line of details when summary is missing', fromDetails === 'First line summary');

  const fallbackTitle = formatOsvTitle(undefined, undefined, 'CVE-2024-0003', 'Fallback');
  expect('uses fallback with CVE ID when summary and details are missing', fallbackTitle === 'Fallback CVE-2024-0003');
});

// 6. NVD: hasVulnerableOsMatch verifies vulnerable criteria matching OS prefix
group('NVD hasVulnerableOsMatch filtering', () => {
  const linuxCpeMatch = 'cpe:2.3:o:linux:linux_kernel:*:*:*:*:*:*:*:*';

  const vulnerableMatchCve = {
    id: 'CVE-2024-1111',
    descriptions: [],
    published: '2024-01-01',
    lastModified: '2024-01-02',
    configurations: [
      {
        nodes: [
          {
            cpeMatch: [
              {
                vulnerable: true,
                criteria: 'cpe:2.3:o:linux:linux_kernel:6.1:*:*:*:*:*:*:*',
              },
            ],
          },
        ],
      },
    ],
  };
  expect(
    'vulnerable OS criterion returns true',
    hasVulnerableOsMatch(vulnerableMatchCve, linuxCpeMatch) === true,
  );

  const nonVulnerableMatchCve = {
    id: 'CVE-2024-2222',
    descriptions: [],
    published: '2024-01-01',
    lastModified: '2024-01-02',
    configurations: [
      {
        nodes: [
          {
            cpeMatch: [
              {
                vulnerable: false,
                criteria: 'cpe:2.3:o:linux:linux_kernel:6.1:*:*:*:*:*:*:*',
              },
              {
                vulnerable: true,
                criteria: 'cpe:2.3:a:someapp:app:1.0:*:*:*:*:*:*:*',
              },
            ],
          },
        ],
      },
    ],
  };
  expect(
    'non-vulnerable OS criterion returns false',
    hasVulnerableOsMatch(nonVulnerableMatchCve, linuxCpeMatch) === false,
  );
});

// 7. Ubuntu OSV parser: order-independent discovery date preservation ([USN-later, standalone, USN-earlier])
group('Ubuntu OSV parser: order-independent discovery date preservation', () => {
  const laterUsn = {
    id: 'USN-2000-1',
    summary: 'Later notice for CVE-2024-9999',
    published: '2024-05-01T10:00:00Z',
    aliases: ['CVE-2024-9999'],
  };
  const standalone = {
    id: 'UBUNTU-CVE-2024-9999',
    summary: 'Standalone Ubuntu CVE entry',
    published: '2024-01-10T10:00:00Z',
  };
  const earlierUsn = {
    id: 'USN-1000-1',
    summary: 'Earlier notice for CVE-2024-9999',
    published: '2024-03-01T10:00:00Z',
    aliases: ['CVE-2024-9999'],
  };

  const records = parseUbuntuVulns([laterUsn, standalone, earlierUsn]);
  const cveRec = records.find((r) => r.id === 'CVE-2024-9999');

  expect('single record retained for CVE', records.filter((r) => r.id === 'CVE-2024-9999').length === 1);
  expect('earliest patch date from USN-1000-1 is retained', cveRec?.patchedDate === '2024-03-01');
  expect('earlier discovery date from standalone entry is preserved', cveRec?.discoveredDate === '2024-01-10');
  expect('patchLagDays reflects preserved discovery date (51 days)', cveRec?.patchLagDays === 51);
});

// 8. Red Hat and Ubuntu CVSS preservation across advisories
group('Red Hat and Ubuntu CVSS preservation', () => {
  const laterRhsa = {
    id: 'RHSA-2024:2000',
    summary: 'Later RHSA with CVSS',
    published: '2024-04-01T10:00:00Z',
    related: ['CVE-2024-8888'],
    severity: [{ type: 'CVSS_V3', score: '8.8' }],
  };
  const earlierRhsa = {
    id: 'RHSA-2024:1000',
    summary: 'Earlier RHSA without CVSS',
    published: '2024-02-01T10:00:00Z',
    related: ['CVE-2024-8888'],
  };
  const rhRecords = parseRedHatVulns([laterRhsa, earlierRhsa]);
  const rhRec = rhRecords.find((r) => r.id === 'CVE-2024-8888');
  expect('Red Hat retains CVSS when earlier advisory replaces later', rhRec?.cvss === 8.8);
  expect('Red Hat retains severity high', rhRec?.severity === 'high');

  const rhRecordsReverse = parseRedHatVulns([earlierRhsa, laterRhsa]);
  const rhRecRev = rhRecordsReverse.find((r) => r.id === 'CVE-2024-8888');
  expect('Red Hat backfills CVSS when later advisory arrives', rhRecRev?.cvss === 8.8);

  const laterUsn = {
    id: 'USN-5000-1',
    summary: 'Later USN with CVSS',
    published: '2024-05-01T10:00:00Z',
    aliases: ['CVE-2024-7777'],
    severity: [{ type: 'CVSS_V3', score: '7.5' }],
  };
  const earlierUsn = {
    id: 'USN-4000-1',
    summary: 'Earlier USN without CVSS',
    published: '2024-03-01T10:00:00Z',
    aliases: ['CVE-2024-7777'],
  };
  const uRecords = parseUbuntuVulns([laterUsn, earlierUsn]);
  const uRec = uRecords.find((r) => r.id === 'CVE-2024-7777');
  expect('Ubuntu retains CVSS when earlier advisory replaces later', uRec?.cvss === 7.5);
  expect('Ubuntu retains severity high', uRec?.severity === 'high');

  const uRecordsRev = parseUbuntuVulns([earlierUsn, laterUsn]);
  const uRecRev = uRecordsRev.find((r) => r.id === 'CVE-2024-7777');
  expect('Ubuntu backfills CVSS when later USN arrives', uRecRev?.cvss === 7.5);
});

// 9. Advisory fallback when no CVE IDs are present
group('Advisory fallback when no CVE IDs are present', () => {
  const noCveRhsa = {
    id: 'RHSA-2024:9999',
    summary: 'General update with no CVE',
    published: '2024-06-01T10:00:00Z',
  };
  const rhRecords = parseRedHatVulns([noCveRhsa]);
  expect('RHSA with no CVEs records under advisory ID', rhRecords.some((r) => r.id === 'RHSA-2024:9999'));

  const noCveUsn = {
    id: 'USN-9999-1',
    summary: 'General USN update with no CVE',
    published: '2024-06-01T10:00:00Z',
  };
  const uRecords = parseUbuntuVulns([noCveUsn]);
  expect('USN with no CVEs records under advisory ID', uRecords.some((r) => r.id === 'USN-9999-1'));

  const detailsRhsa = {
    id: 'RHSA-2024:8888',
    summary: 'Advisory with CVE only in details',
    details: 'This update fixes CVE-2024-5555 in the package.',
    published: '2024-06-01T10:00:00Z',
  };
  const rhDetails = parseRedHatVulns([detailsRhsa]);
  expect('RHSA extracts CVE from details string', rhDetails.some((r) => r.id === 'CVE-2024-5555'));
});

// 10. Linux Kernel parser edge cases
group('Linux Kernel parser edge cases', () => {
  const modifiedOnlyVuln = {
    id: 'CVE-2024-6000',
    summary: 'Modified date fallback',
    modified: '2024-05-15T10:00:00Z',
  };
  const rec = osvToRecord(modifiedOnlyVuln);
  expect('discoveredDate falls back to modified when published is missing', rec?.discoveredDate === '2024-05-15');

  const noCveVuln = {
    id: 'GHSA-xxxx-yyyy',
    summary: 'No CVE alias',
    published: '2024-05-15T10:00:00Z',
  };
  expect('missing CVE ID returns null', osvToRecord(noCveVuln) === null);
});

// 11. extractCvss vector parsing and inferManufacturer text fallbacks
group('extractCvss vector parsing and inferManufacturer text fallbacks', () => {
  expect('extractCvss parses numeric score', extractCvss([{ type: 'CVSS_V3', score: '7.8' }]) === 7.8);

  const vectorScoreChanged = extractCvss([
    { type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H' },
  ]);
  expect('extractCvss computes score for Scope Changed vector (10)', vectorScoreChanged === 10);

  const vectorPrL = extractCvss([
    { type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H' },
  ]);
  expect('extractCvss computes score for Scope Changed with PR:L', typeof vectorPrL === 'number' && vectorPrL > 0);

  const vectorPrH = extractCvss([
    { type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:C/C:H/I:H/A:H' },
  ]);
  expect('extractCvss computes score for Scope Changed with PR:H', typeof vectorPrH === 'number' && vectorPrH > 0);

  const incompleteVector = extractCvss([
    { type: 'CVSS_V3', score: 'CVSS:3.1/AV:N' },
  ]);
  expect('extractCvss returns undefined for incomplete vector', incompleteVector === undefined);

  const vectorScoreUnchanged = extractCvss([
    { type: 'CVSS_V3', score: 'CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N' },
  ]);
  expect('extractCvss computes score for Scope Unchanged vector (>0)', typeof vectorScoreUnchanged === 'number' && vectorScoreUnchanged > 0);

  const makeTextOsv = (text) => ({ id: 'TEST-1', summary: text });
  expect('apple in text maps to Apple', inferManufacturer(makeTextOsv('Security update for Apple products'), 'CVE-2024-1') === 'Apple');
  expect('macos in text maps to Apple', inferManufacturer(makeTextOsv('Kernel update for macOS'), 'CVE-2024-1') === 'Apple');
  expect('ios in text maps to Apple', inferManufacturer(makeTextOsv('Buffer overflow on iOS devices'), 'CVE-2024-1') === 'Apple');
  expect('ubuntu in text maps to Ubuntu', inferManufacturer(makeTextOsv('Ubuntu package flaw'), 'CVE-2024-1') === 'Ubuntu');
  expect('red hat in text maps to Red Hat', inferManufacturer(makeTextOsv('Red Hat Enterprise Linux bug'), 'CVE-2024-1') === 'Red Hat');
  expect('rhel in text maps to Red Hat', inferManufacturer(makeTextOsv('RHEL 9 package update'), 'CVE-2024-1') === 'Red Hat');
  expect('linux kernel in text maps to Linux', inferManufacturer(makeTextOsv('Flaw in linux kernel network stack'), 'CVE-2024-1') === 'Linux');
  expect('microsoft in text maps to Microsoft', inferManufacturer(makeTextOsv('Microsoft Office vulnerability'), 'CVE-2024-1') === 'Microsoft');
  expect('oracle in text maps to Oracle', inferManufacturer(makeTextOsv('Oracle Database issue'), 'CVE-2024-1') === 'Oracle');
  expect('unrelated text maps to undefined', inferManufacturer(makeTextOsv('Some random proprietary app'), 'CVE-2024-1') === undefined);
});

// 12. NVD hasVulnerableOsMatch wildcard product criteria
group('NVD hasVulnerableOsMatch wildcard product criteria', () => {
  const redhatWildcardCpe = 'cpe:2.3:a:redhat:*:*:*:*:*:*:*:*';
  const cveRedhatApp = {
    id: 'CVE-2024-3333',
    configurations: [
      {
        nodes: [
          {
            cpeMatch: [
              {
                vulnerable: true,
                criteria: 'cpe:2.3:a:redhat:ansible_tower:3.8:*:*:*:*:*:*:*',
              },
            ],
          },
        ],
      },
    ],
  };
  expect('Red Hat wildcard product matches application criterion', hasVulnerableOsMatch(cveRedhatApp, redhatWildcardCpe) === true);

  const ubuntuWildcardCpe = 'cpe:2.3:a:canonical:*:*:*:*:*:*:*:*';
  const cveCanonicalApp = {
    id: 'CVE-2024-4444',
    configurations: [
      {
        nodes: [
          {
            cpeMatch: [
              {
                vulnerable: true,
                criteria: 'cpe:2.3:a:canonical:snapd:2.57:*:*:*:*:*:*:*',
              },
            ],
          },
        ],
      },
    ],
  };
  expect('Canonical wildcard product matches application criterion', hasVulnerableOsMatch(cveCanonicalApp, ubuntuWildcardCpe) === true);
});

// Helper to construct a minimal ZIP file in memory for testing fetchRecords
function createMockZip(filename, jsonContent) {
  const fileData = Buffer.from(JSON.stringify(jsonContent), 'utf8');
  const compressed = deflateRawSync(fileData);
  const nameBuf = Buffer.from(filename, 'utf8');

  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(fileData.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  nameBuf.copy(localHeader, 30);

  const localOffset = 0;
  const cdOffset = localHeader.length + compressed.length;

  const cdHeader = Buffer.alloc(46 + nameBuf.length);
  cdHeader.writeUInt32LE(0x02014b50, 0);
  cdHeader.writeUInt16LE(20, 4);
  cdHeader.writeUInt16LE(20, 6);
  cdHeader.writeUInt16LE(0, 8);
  cdHeader.writeUInt16LE(8, 10);
  cdHeader.writeUInt32LE(compressed.length, 20);
  cdHeader.writeUInt32LE(fileData.length, 24);
  cdHeader.writeUInt16LE(nameBuf.length, 28);
  cdHeader.writeUInt32LE(localOffset, 42);
  nameBuf.copy(cdHeader, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdHeader.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([localHeader, compressed, cdHeader, eocd]);
}

// 13. fetchRecords integration with mock ZIP responses
await group('fetchRecords integration with mock ZIP responses', async () => {
  const origFetch = globalThis.fetch;
  try {
    const linuxZip = createMockZip('CVE-2024-1000.json', {
      id: 'CVE-2024-1000',
      summary: 'Linux test vuln',
      published: '2024-03-01T00:00:00Z',
    });
    globalThis.fetch = async () => new Response(linuxZip, { status: 200 });
    const linuxRecs = await fetchLinuxRecords();
    expect('fetchLinuxRecords parses records from downloaded zip', linuxRecs.length === 1 && linuxRecs[0]?.id === 'CVE-2024-1000');

    const rhZip = createMockZip('RHSA-2024-1001.json', {
      id: 'RHSA-2024:1001',
      summary: 'RHSA test vuln',
      published: '2024-03-01T00:00:00Z',
      related: ['CVE-2024-1001'],
    });
    globalThis.fetch = async () => new Response(rhZip, { status: 200 });
    const rhRecs = await fetchRedHatRecords();
    expect('fetchRedHatRecords parses records from downloaded zip', rhRecs.length === 1 && rhRecs[0]?.id === 'CVE-2024-1001');

    const uZip = createMockZip('USN-1002-1.json', {
      id: 'USN-1002-1',
      summary: 'USN test vuln',
      published: '2024-03-01T00:00:00Z',
      aliases: ['CVE-2024-1002'],
    });
    globalThis.fetch = async () => new Response(uZip, { status: 200 });
    const uRecs = await fetchUbuntuRecords();
    expect('fetchUbuntuRecords parses records from downloaded zip', uRecs.length === 1 && uRecs[0]?.id === 'CVE-2024-1002');

    // OSV stub without CVE list env var
    delete process.env.OSV_LOOKUP_CVE_LIST;
    const osvEmpty = await fetchOsvRecords();
    expect('fetchOsvRecords returns empty array when OSV_LOOKUP_CVE_LIST is unset', osvEmpty.length === 0);

    // OSV stub with nonexistent file
    process.env.OSV_LOOKUP_CVE_LIST = 'nonexistent-cve-list.txt';
    const osvMissing = await fetchOsvRecords();
    expect('fetchOsvRecords returns empty array when list file is missing', osvMissing.length === 0);
    delete process.env.OSV_LOOKUP_CVE_LIST;
  } finally {
    globalThis.fetch = origFetch;
  }
});

// 14. NVD cveToRecord unit tests
group('NVD cveToRecord parsing', () => {
  const nvdCve = {
    id: 'CVE-2024-5000',
    descriptions: [{ lang: 'en', value: 'Test description of CVE-2024-5000' }],
    published: '2024-02-15T00:00:00.000',
    metrics: {
      cvssMetricV31: [
        {
          cvssData: { baseScore: 9.8 },
        },
      ],
    },
    references: [
      {
        url: 'https://example.com/advisory',
        tags: ['Vendor Advisory'],
      },
    ],
  };

  const rec = cveToRecord(nvdCve, 'Linux');
  expect('cveToRecord parses id', rec?.id === 'CVE-2024-5000');
  expect('cveToRecord parses cvss score', rec?.cvss === 9.8);
  expect('cveToRecord maps severity critical', rec?.severity === 'critical');
  expect('cveToRecord uses vendor advisory rawUrl', rec?.rawUrl === 'https://example.com/advisory');

  const longDesc = 'B'.repeat(300);
  const nvdLong = {
    id: 'CVE-2024-5001',
    descriptions: [{ lang: 'en', value: longDesc }],
    published: '2024-02-15T00:00:00.000',
  };
  const recLong = cveToRecord(nvdLong, 'Ubuntu');
  expect('cveToRecord truncates long description to 201 chars (with ellipsis)', recLong?.title.length === 201 && recLong?.title.endsWith('…'));

  const nvdNoDate = {
    id: 'CVE-2024-5002',
    descriptions: [{ lang: 'en', value: 'No date' }],
  };
  expect('cveToRecord returns null when published date is missing', cveToRecord(nvdNoDate, 'Red Hat') === null);
});

// 15. collectOsvCveIds helper tests
group('collectOsvCveIds helper', () => {
  const vuln = {
    aliases: ['cve-2024-0001', 'GHSA-xxxx-yyyy'],
    related: ['CVE-2024-0002'],
    upstream: ['https://git.kernel.org/commit/CVE-2024-0003'],
    details: 'This resolves CVE-2024-0004 and duplicates cve-2024-0001.',
  };
  const ids = collectOsvCveIds(vuln);
  expect('collectOsvCveIds extracts and deduplicates uppercase CVEs', ids.length === 4);
  expect('contains all 4 CVE IDs', ids.includes('CVE-2024-0001') && ids.includes('CVE-2024-0002') && ids.includes('CVE-2024-0003') && ids.includes('CVE-2024-0004'));
});

// 16. inferManufacturer ecosystem coverage
group('inferManufacturer ecosystem coverage', () => {
  const makeEcoOsv = (ecosystem) => ({ id: 'TEST', affected: [{ package: { ecosystem } }] });
  expect('Mozilla ecosystem maps to Mozilla', inferManufacturer(makeEcoOsv('Mozilla'), 'CVE-1') === 'Mozilla');
  expect('Chrome ecosystem maps to Google', inferManufacturer(makeEcoOsv('Chrome'), 'CVE-1') === 'Google');
  expect('Android ecosystem maps to Google', inferManufacturer(makeEcoOsv('Android'), 'CVE-1') === 'Google');
  expect('Adobe ecosystem maps to Adobe', inferManufacturer(makeEcoOsv('Adobe'), 'CVE-1') === 'Adobe');
  expect('macOS ecosystem maps to Apple', inferManufacturer(makeEcoOsv('macOS'), 'CVE-1') === 'Apple');
});

// 17. Linux Kernel branch coverage
group('Linux Kernel parser branches', () => {
  const invalidDateVuln = {
    id: 'CVE-2024-9001',
    summary: 'Invalid date vuln',
    published: 'not-a-valid-date',
  };
  expect('osvToRecord returns null on invalid date', osvToRecord(invalidDateVuln) === null);

  const advisoryRefVuln = {
    id: 'CVE-2024-9002',
    summary: 'Advisory ref vuln',
    published: '2024-01-01',
    references: [{ type: 'ADVISORY', url: 'https://kernel.org/advisory/9002' }],
  };
  const rec = osvToRecord(advisoryRefVuln);
  expect('osvToRecord uses ADVISORY reference url', rec?.rawUrl === 'https://kernel.org/advisory/9002');

  const dupVulns = [advisoryRefVuln, advisoryRefVuln];
  const parsed = parseLinuxVulns(dupVulns);
  expect('parseLinuxVulns deduplicates duplicate records', parsed.length === 1);
});

// 18. OSV enrichment fetch with valid CVE list
await group('OSV enrichment fetch with active list file', async () => {
  const tmpList = join(tmpdir(), `osv-test-list-${Date.now()}.txt`);
  await writeFile(tmpList, 'CVE-2024-7777\n', 'utf8');
  process.env.OSV_LOOKUP_CVE_LIST = tmpList;

  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          id: 'CVE-2024-7777',
          summary: 'Enriched OSV CVE',
          published: '2024-03-01T00:00:00Z',
          modified: '2024-03-05T00:00:00Z',
          affected: [{ package: { ecosystem: 'Linux' } }],
          references: [{ type: 'WEB', url: 'https://osv.dev/v/CVE-2024-7777' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const recs = await fetchOsvRecords();
    expect('fetchOsvRecords enriches records from CVE list', recs.length === 1 && recs[0]?.id === 'CVE-2024-7777');
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.OSV_LOOKUP_CVE_LIST;
    await unlink(tmpList).catch(() => {});
  }
});

// 19. NVD fetchCvePage and fetchRecords integration
await group('NVD fetchCvePage and fetchRecords integration', async () => {
  const origFetch = globalThis.fetch;
  process.env.NVD_DELAY_MS = '0';

  try {
    // 1. fetchCvePage success
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          resultsPerPage: 1,
          startIndex: 0,
          totalResults: 1,
          vulnerabilities: [
            {
              cve: {
                id: 'CVE-2024-9000',
                descriptions: [{ lang: 'en', value: 'NVD test page vuln' }],
                published: '2024-01-01T00:00:00.000',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const page = await fetchCvePage('microsoft', 0);
    expect('fetchCvePage parses NVD response', page.totalResults === 1 && page.vulnerabilities.length === 1);

    const pageWithMatch = await fetchCvePage('redhat', 0, 'cpe:2.3:o:redhat:enterprise_linux:8:*:*:*:*:*:*:*');
    expect('fetchCvePage supports custom cpeMatch parameter', pageWithMatch.totalResults === 1);

    // 2. fetchCvePage error
    globalThis.fetch = async () =>
      new Response('Internal Server Error', { status: 500 });
    let threw500 = false;
    try {
      await fetchCvePage('microsoft', 0);
    } catch {
      threw500 = true;
    }
    expect('fetchCvePage throws on non-200 response', threw500 === true);

    // 3. fetchRecords with mock queries and simulated failure on one query
    let callCount = 0;
    globalThis.fetch = async (url) => {
      callCount++;
      // Simulate failure on the first call to test per-vendor resilience catch block
      if (callCount === 1) {
        return new Response('Fail', { status: 500 });
      }
      return new Response(
        JSON.stringify({
          resultsPerPage: 1,
          startIndex: 0,
          totalResults: 1,
          vulnerabilities: [
            {
              cve: {
                id: `CVE-2024-${callCount}`,
                descriptions: [{ lang: 'en', value: `NVD test vuln ${callCount}` }],
                published: '2024-01-01T00:00:00.000',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const nvdRecords = await fetchNvdRecords();
    expect('fetchNvdRecords extracts records across queries despite vendor failure', nvdRecords.length > 0);
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.NVD_DELAY_MS;
  }
});

console.log(
  `\n${'='.repeat(60)}\nResults: ${passed} passed, ${failed} failed\n${'='.repeat(60)}`,
);
if (failed > 0) {
  process.exit(1);
}
