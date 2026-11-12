// Unit tests for Linux Kernel, Red Hat, and Ubuntu OSV parsers
// Verifies fix handling, earliest patch date selection, and avoidance of fabricated patch lags.

import { osvToRecord, parseLinuxVulns } from './sources/linux.js';
import { parseRedHatVulns } from './sources/redhat.js';
import { parseUbuntuVulns } from './sources/ubuntu.js';

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
});

// 2. Red Hat: Retains earliest RHSA patch release date when multiple advisories resolve the same CVE
group('Red Hat OSV parser: earliest patch date selection', () => {
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
  const standaloneBeforeUsn = {
    id: 'UBUNTU-CVE-2024-7777',
    aliases: ['cve-2024-7777'],
    summary: 'Earlier standalone entry',
    published: '2024-01-01T10:00:00Z',
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
});

console.log(
  `\n${'='.repeat(60)}\nResults: ${passed} passed, ${failed} failed\n${'='.repeat(60)}`,
);
if (failed > 0) {
  process.exit(1);
}
