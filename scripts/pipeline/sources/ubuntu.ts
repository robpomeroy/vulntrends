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

import { buildRecord, computePatchLagDays, parseDate } from '../normalise.js';
import { fetchBufferWithRetry } from '../fetch-with-retry.js';
import { iterateZipJsonEntries } from '../zip-reader.js';
import { extractCvss, formatOsvTitle } from './osv.js';
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
  withdrawn?: string;
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

export function parseUbuntuVulns(osvVulns: Iterable<OsvUbuntuVuln>): VulnerabilityRecord[] {
  const usnAdvisoryRecords: VulnerabilityRecord[] = [];
  const usnCveRecords = new Map<string, VulnerabilityRecord>();
  const standaloneRecords = new Map<string, VulnerabilityRecord>();

  for (const vuln of osvVulns) {
    if (vuln.withdrawn) continue;

    if (vuln.id.startsWith('USN-')) {
      // Process authoritative Ubuntu Security Notices (USNs)
      const patchDate = parseDate(vuln.published ?? vuln.modified);
      if (!patchDate) continue;

      // Collect all CVE IDs referenced by this USN and per-CVE severity if provided
      const cveSet = new Set<string>();
      const cveSeverityMap = new Map<string, Array<{ type: string; score: string }>>();

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
          if (/^CVE-\d{4}-\d{4,}$/i.test(c.id)) {
            const idUpper = c.id.toUpperCase();
            cveSet.add(idUpper);
            if (c.severity && c.severity.length > 0 && !cveSeverityMap.has(idUpper)) {
              cveSeverityMap.set(idUpper, c.severity);
            }
          }
        }
      }

      const cveList = [...cveSet];
      const title = formatOsvTitle(vuln.summary, vuln.details, vuln.id, 'Ubuntu Security Notice');
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
            cvss: extractCvss(vuln.severity),
            discoveredDate: patchDate,
            publishedDate: patchDate,
            patchedDate: patchDate,
            rawUrl,
          }),
        );
      } else {
        for (const cveId of cveList) {
          // Retain the earliest patch release date when multiple USNs address the same CVE.
          // Short-circuit before expensive buildRecord allocation and schema validation.
          const existing = usnCveRecords.get(cveId);
          if (existing?.patchedDate && patchDate >= existing.patchedDate) {
            continue;
          }

          // Prefer per-CVE CVSS/severity from database_specific.cves_map, fallback to top-level
          const perCveSeverity = cveSeverityMap.get(cveId) ?? vuln.severity;
          const cvss = extractCvss(perCveSeverity);

          // If a standalone record was already registered for this CVE, merge its discoveredDate
          let discoveredDate = patchDate;
          const standaloneRec = standaloneRecords.get(cveId);
          if (standaloneRec) {
            if (standaloneRec.discoveredDate < discoveredDate) {
              discoveredDate = standaloneRec.discoveredDate;
            }
            standaloneRecords.delete(cveId);
          }

          const candidate = buildRecord({
            id: cveId,
            source: 'ubuntu',
            manufacturer: 'Ubuntu',
            product,
            title: `${title} — ${cveId}`.slice(0, 200),
            cvss,
            discoveredDate,
            publishedDate: patchDate,
            patchedDate: patchDate,
            patchLagDays: computePatchLagDays(discoveredDate, patchDate),
            cveIds: [cveId],
            rawUrl,
          });

          usnCveRecords.set(cveId, candidate);
        }
      }
    } else {
      // Standalone Ubuntu CVE tracking records for any CVE not covered by a USN.
      // Note: For standalone Ubuntu CVE entries (non-USN), vuln.modified is the timestamp when
      // Canonical's automated OSV exporter last regenerated the JSON metadata file, not when a
      // security package was released to Ubuntu archives. Real security fixes in Ubuntu are
      // published through USNs (handled above). If a CVE does not have a USN notice, patchedDate
      // intentionally remains undefined to prevent fabricating artificial patch lags.
      let rawCveId = (vuln.aliases ?? []).find((a) => /^CVE-\d{4}-\d{4,}$/i.test(a));
      if (!rawCveId && /^UBUNTU-CVE-\d{4}-\d{4,}$/i.test(vuln.id)) {
        rawCveId = vuln.id.replace(/^UBUNTU-/i, '');
      }
      if (!rawCveId) continue;
      const cveId = rawCveId.toUpperCase();

      const date = parseDate(vuln.published ?? vuln.modified);
      if (!date) continue;

      // If already covered by a USN, merge earlier discovery date immediately and avoid storing standalone record
      const usnRec = usnCveRecords.get(cveId);
      if (usnRec) {
        if (date < usnRec.discoveredDate) {
          usnRec.discoveredDate = date;
          usnRec.patchLagDays = computePatchLagDays(usnRec.discoveredDate, usnRec.patchedDate);
        }
        continue;
      }

      if (standaloneRecords.has(cveId)) continue;

      const title = formatOsvTitle(vuln.summary, vuln.details, cveId, 'Ubuntu CVE');
      const product = vuln.affected?.[0]?.package?.name || 'Ubuntu';

      standaloneRecords.set(
        cveId,
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
  }

  // Standalone tracking records are only retained if the CVE is not covered by a USN.
  // Any standalone record matched by a USN was merged above and removed from standaloneRecords.
  return [...usnAdvisoryRecords, ...usnCveRecords.values(), ...standaloneRecords.values()];
}

export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Ubuntu: downloading OSV bulk archive...');
  const buffer = await fetchBufferWithRetry(UBUNTU_OSV_ZIP_URL, {
    headers: { 'User-Agent': 'VulnTrends/0.1' },
    timeoutMs: 180_000,
  });

  console.log('Ubuntu: streaming records from zip...');
  const records = parseUbuntuVulns(iterateZipJsonEntries<OsvUbuntuVuln>(buffer));
  console.log(`Ubuntu: ${records.length} records extracted`);
  return records;
}
