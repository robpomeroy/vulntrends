/**
 * Red Hat security advisories parser.
 *
 * Source: Open Source Vulnerability (OSV) bulk data for Red Hat:
 *   https://storage.googleapis.com/osv-vulnerabilities/Red%20Hat/all.zip
 *
 * This feed indexes all official Red Hat Security Advisories (RHSA), providing
 * authoritative patch release dates, CVSS scores, affected packages, and the
 * CVE identifiers resolved by each advisory.
 */

import { buildRecord, cvssToSeverity, parseDate } from '../normalise.js';
import { fetchBufferWithRetry } from '../fetch-with-retry.js';
import { iterateZipJsonEntries } from '../zip-reader.js';
import { collectOsvCveIds, extractCvss, formatOsvTitle } from './osv.js';
import type { VulnerabilityRecord } from '../types.js';

const REDHAT_OSV_ZIP_URL =
  'https://storage.googleapis.com/osv-vulnerabilities/Red%20Hat/all.zip';

interface OsvRedHatVuln {
  id: string; // RHSA-YYYY:NNNN
  summary?: string;
  details?: string;
  published?: string;
  modified?: string;
  withdrawn?: string;
  related?: string[];
  aliases?: string[];
  upstream?: string[];
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{
    package?: { name?: string; ecosystem?: string };
    ecosystem_specific?: {
      advisory?: string;
    };
  }>;
  references?: Array<{ url: string; type?: string }>;
}

export function parseRedHatVulns(osvVulns: Iterable<OsvRedHatVuln>): VulnerabilityRecord[] {
  const advisoryRecords: VulnerabilityRecord[] = [];
  const cveRecords = new Map<string, VulnerabilityRecord>();

  for (const vuln of osvVulns) {
    if (vuln.withdrawn) continue;
    const patchDate = parseDate(vuln.published ?? vuln.modified);
    if (!patchDate) continue;

    // Collect all CVE IDs referenced by this advisory
    const cveList = collectOsvCveIds(vuln);
    const cvss = extractCvss(vuln.severity);
    const title = formatOsvTitle(vuln.summary, vuln.details, vuln.id, 'Red Hat Advisory');
    const product =
      vuln.affected?.[0]?.package?.name || 'Red Hat Enterprise Linux';
    const rawUrl = `https://access.redhat.com/errata/${encodeURIComponent(vuln.id)}`;

    if (cveList.length === 0) {
      // If the advisory specifies no CVEs, record under the advisory ID
      advisoryRecords.push(
        buildRecord({
          id: vuln.id,
          source: 'redhat',
          manufacturer: 'Red Hat',
          product,
          title,
          cvss,
          discoveredDate: patchDate,
          publishedDate: patchDate,
          patchedDate: patchDate,
          rawUrl,
        }),
      );
    } else {
      for (const cveId of cveList) {
        // Retain the earliest patch release date when multiple RHSAs address the same CVE.
        // Short-circuit before expensive buildRecord allocation and schema validation.
        const existing = cveRecords.get(cveId);
        if (existing?.patchedDate && patchDate >= existing.patchedDate) {
          // If existing lacks CVSS score but new advisory has one, backfill it
          if (existing.cvss === undefined && cvss !== undefined) {
            existing.cvss = cvss;
            existing.severity = cvssToSeverity(cvss);
          }
          continue;
        }

        const candidate = buildRecord({
          id: cveId,
          source: 'redhat',
          manufacturer: 'Red Hat',
          product,
          title: `${title} — ${cveId}`.slice(0, 200),
          cvss: cvss ?? existing?.cvss,
          discoveredDate: patchDate,
          publishedDate: patchDate,
          patchedDate: patchDate,
          cveIds: [cveId],
          rawUrl,
        });

        cveRecords.set(cveId, candidate);
      }
    }
  }

  return [...advisoryRecords, ...cveRecords.values()];
}

export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Red Hat: downloading OSV bulk archive...');
  const buffer = await fetchBufferWithRetry(REDHAT_OSV_ZIP_URL, {
    headers: { 'User-Agent': 'VulnTrends/0.1' },
    timeoutMs: 180_000,
  });

  console.log('Red Hat: streaming records from zip...');
  const records = parseRedHatVulns(iterateZipJsonEntries<OsvRedHatVuln>(buffer));
  console.log(`Red Hat: ${records.length} records extracted`);
  return records;
}
