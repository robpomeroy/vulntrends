/**
 * Ubuntu security advisories parser.
 *
 * Source: Open Source Vulnerability (OSV) bulk data for Ubuntu:
 *   https://storage.googleapis.com/osv-vulnerabilities/Ubuntu/all.zip
 *
 * This feed is published by Canonical and mirrors Ubuntu Security Notices (USNs)
 * and Ubuntu CVE tracking in the standard OSV JSON format.
 * Each USN provides an official release date for the security update (patchedDate)
 * and references the upstream CVE IDs.
 */

import { buildRecord, parseDate } from '../normalise.js';
import { fetchWithRetry } from '../fetch-with-retry.js';
import { extractZipJsonEntries } from '../zip-reader.js';
import { extractCvss } from './osv.js';
import type { VulnerabilityRecord } from '../types.js';

const UBUNTU_OSV_ZIP_URL = 'https://storage.googleapis.com/osv-vulnerabilities/Ubuntu/all.zip';

interface OsvUbuntuCveEntry {
  id: string;
  severity?: Array<{ type: string; score: string }>;
}

interface OsvUbuntuVuln {
  id: string;
  summary?: string;
  details?: string;
  published?: string;
  modified?: string;
  aliases?: string[];
  upstream?: string[];
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{
    package?: { name?: string; ecosystem?: string };
    ranges?: Array<{
      events?: Array<{ introduced?: string; fixed?: string }>;
    }>;
    database_specific?: {
      cves_map?: {
        cves?: OsvUbuntuCveEntry[];
      };
    };
  }>;
  references?: Array<{ url: string; type?: string }>;
}

export function parseUbuntuVulns(osvVulns: OsvUbuntuVuln[]): VulnerabilityRecord[] {
  const usnAdvisoryRecords: VulnerabilityRecord[] = [];
  const usnCveRecords = new Map<string, VulnerabilityRecord>();

  // Process USN notices first (authoritative patch release notices)
  const usnEntries = osvVulns.filter((v) => v.id.startsWith('USN-'));
  const otherEntries = osvVulns.filter((v) => !v.id.startsWith('USN-'));

  for (const vuln of usnEntries) {
    const patchDate = parseDate(vuln.published ?? vuln.modified);
    if (!patchDate) continue;

    // Collect all CVE IDs referenced by this USN
    const cveSet = new Set<string>();

    for (const alias of vuln.aliases ?? []) {
      if (/^CVE-\d{4}-\d{4,}$/i.test(alias)) cveSet.add(alias.toUpperCase());
    }
    for (const up of vuln.upstream ?? []) {
      const m = up.match(/CVE-\d{4}-\d{4,}/i);
      if (m) cveSet.add(m[0].toUpperCase());
    }
    for (const aff of vuln.affected ?? []) {
      const cves = aff.database_specific?.cves_map?.cves ?? [];
      for (const c of cves) {
        if (/^CVE-\d{4}-\d{4,}$/i.test(c.id)) cveSet.add(c.id.toUpperCase());
      }
    }

    const cveList = [...cveSet];
    const cvss = extractCvss(vuln.severity);
    const rawTitle = vuln.summary?.trim() || vuln.details?.split('\n')[0]?.trim();
    const title = (rawTitle || `Ubuntu Security Notice ${vuln.id}`).slice(0, 200);
    const product = vuln.affected?.[0]?.package?.name || 'Ubuntu';
    const rawUrl = `https://ubuntu.com/security/notices/${vuln.id}`;

    if (cveList.length === 0) {
      usnAdvisoryRecords.push(
        buildRecord({
          id: vuln.id,
          source: 'ubuntu',
          manufacturer: 'Ubuntu',
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
          source: 'ubuntu',
          manufacturer: 'Ubuntu',
          product,
          title: `${title} — ${cveId}`,
          cvss,
          discoveredDate: patchDate,
          publishedDate: patchDate,
          patchedDate: patchDate,
          cveIds: [cveId],
          rawUrl,
        });

        // Retain the earliest patch release date when multiple USNs address the same CVE
        const existing = usnCveRecords.get(cveId);
        if (!existing || (existing.patchedDate && patchDate < existing.patchedDate)) {
          usnCveRecords.set(cveId, candidate);
        }
      }
    }
  }

  // Next, include standalone Ubuntu CVE tracking records for any CVE not already in a USN.
  // Note: For standalone Ubuntu CVE entries (non-USN), vuln.modified is the timestamp when
  // Canonical's automated OSV exporter last regenerated the JSON metadata file, not when a
  // security package was released to Ubuntu archives. Real security fixes in Ubuntu are
  // published through USNs (handled above). If a CVE does not have a USN notice, patchedDate
  // intentionally remains undefined to prevent fabricating artificial patch lags.
  const standaloneRecords: VulnerabilityRecord[] = [];
  const seenStandalone = new Set<string>();

  for (const vuln of otherEntries) {
    let cveId = (vuln.aliases ?? []).find((a) => /^CVE-\d{4}-\d{4,}$/i.test(a));
    if (!cveId && vuln.id.startsWith('UBUNTU-CVE-')) {
      cveId = vuln.id.replace('UBUNTU-', '');
    }
    if (!cveId || usnCveRecords.has(cveId) || seenStandalone.has(cveId)) continue;

    const date = parseDate(vuln.published ?? vuln.modified);
    if (!date) continue;

    const rawTitle = vuln.summary?.trim() || vuln.details?.split('\n')[0]?.trim();
    const title = (rawTitle || `Ubuntu CVE ${cveId}`).slice(0, 200);
    const product = vuln.affected?.[0]?.package?.name || 'Ubuntu';

    seenStandalone.add(cveId);
    standaloneRecords.push(
      buildRecord({
        id: cveId,
        source: 'ubuntu',
        manufacturer: 'Ubuntu',
        product,
        title,
        cvss: extractCvss(vuln.severity),
        discoveredDate: date,
        publishedDate: parseDate(vuln.published),
        patchedDate: undefined,
        cveIds: [cveId],
        rawUrl: `https://ubuntu.com/security/${cveId}`,
      }),
    );
  }

  return [...usnAdvisoryRecords, ...usnCveRecords.values(), ...standaloneRecords];
}

export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Ubuntu: downloading OSV bulk archive...');
  const response = await fetchWithRetry(UBUNTU_OSV_ZIP_URL, {
    headers: { 'User-Agent': 'VulnTrends/0.1' },
    timeoutMs: 60_000,
  });

  if (!response.ok) {
    throw new Error(`Ubuntu OSV zip fetch failed: HTTP ${response.status}`);
  }

  console.log('Ubuntu: extracting records from zip...');
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const osvVulns = extractZipJsonEntries<OsvUbuntuVuln>(buffer);
  console.log(`Ubuntu: read ${osvVulns.length} entries from archive`);

  const records = parseUbuntuVulns(osvVulns);
  console.log(`Ubuntu: ${records.length} records extracted`);
  return records;
}
