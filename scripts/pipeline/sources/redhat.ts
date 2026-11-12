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

import { buildRecord, extractCveIds, parseDate } from '../normalise.js';
import { fetchWithRetry } from '../fetch-with-retry.js';
import { iterateZipJsonEntries } from '../zip-reader.js';
import { extractCvss } from './osv.js';
import type { VulnerabilityRecord } from '../types.js';

const REDHAT_OSV_ZIP_URL =
  'https://storage.googleapis.com/osv-vulnerabilities/Red%20Hat/all.zip';

interface OsvRedHatVuln {
  id: string; // RHSA-YYYY:NNNN
  summary?: string;
  details?: string;
  published?: string;
  modified?: string;
  related?: string[];
  aliases?: string[];
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
    const patchDate = parseDate(vuln.published ?? vuln.modified);
    if (!patchDate) continue;

    // Collect all CVE IDs referenced by this advisory
    const cveSet = new Set<string>();
    for (const rel of vuln.related ?? []) {
      if (/^CVE-\d{4}-\d{4,}$/i.test(rel)) cveSet.add(rel.toUpperCase());
    }
    for (const alias of vuln.aliases ?? []) {
      if (/^CVE-\d{4}-\d{4,}$/i.test(alias)) cveSet.add(alias.toUpperCase());
    }
    const fromDetails = extractCveIds(vuln.details);
    if (fromDetails) {
      for (const c of fromDetails) cveSet.add(c.toUpperCase());
    }

    const cveList = [...cveSet];
    const cvss = extractCvss(vuln.severity);
    const rawTitle = vuln.summary?.trim() || vuln.details?.split('\n')[0]?.trim();
    const title = (rawTitle || `Red Hat Advisory ${vuln.id}`).slice(0, 200);
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
        const candidate = buildRecord({
          id: cveId,
          source: 'redhat',
          manufacturer: 'Red Hat',
          product,
          title: `${title} — ${cveId}`,
          cvss,
          discoveredDate: patchDate,
          publishedDate: patchDate,
          patchedDate: patchDate,
          cveIds: [cveId],
          rawUrl,
        });

        // Retain the earliest patch release date when multiple RHSAs address the same CVE
        const existing = cveRecords.get(cveId);
        if (!existing || (existing.patchedDate && patchDate < existing.patchedDate)) {
          cveRecords.set(cveId, candidate);
        }
      }
    }
  }

  return [...advisoryRecords, ...cveRecords.values()];
}

export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Red Hat: downloading OSV bulk archive...');
  const response = await fetchWithRetry(REDHAT_OSV_ZIP_URL, {
    headers: { 'User-Agent': 'VulnTrends/0.1' },
    timeoutMs: 60_000,
  });

  if (!response.ok) {
    throw new Error(`Red Hat OSV zip fetch failed: HTTP ${response.status}`);
  }

  console.log('Red Hat: streaming records from zip...');
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const records = parseRedHatVulns(iterateZipJsonEntries<OsvRedHatVuln>(buffer));
  console.log(`Red Hat: ${records.length} records extracted`);
  return records;
}
