// Unit tests for Linux Kernel, Red Hat, and Ubuntu OSV parsers
// Verifies fix handling, earliest patch date selection, and avoidance of fabricated patch lags.

import { osvToRecord, parseLinuxVulns } from './sources/linux.js';
import { parseRedHatVulns } from './sources/redhat.js';
import { parseUbuntuVulns } from './sources/ubuntu.js';
import { inferManufacturer, formatOsvTitle } from './sources/osv.js';
import { hasVulnerableOsMatch } from './sources/nvd.js';

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

function group(name, fn) {
  console.log(`\n── ${name} ──`);
  fn();
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

console.log(
  `\n${'='.repeat(60)}\nResults: ${passed} passed, ${failed} failed\n${'='.repeat(60)}`,
);
if (failed > 0) {
  process.exit(1);
}
