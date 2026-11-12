/**
 * Linux Kernel vulnerability parser.
 *
 * Source: Open Source Vulnerability (OSV) bulk data for the Linux ecosystem:
 *   https://storage.googleapis.com/osv-vulnerabilities/Linux/all.zip
 *
 * This feed directly mirrors the Linux kernel CNA disclosures (cvelistV5 /
 * linux-cve-announce) without the multi-week enrichment delays often seen in NVD.
 * Provides rich metadata including commit fixes, publication dates, and affected
 * Git versions.
 */

import { buildRecord, parseDate } from '../normalise.js';
import { fetchWithRetry } from '../fetch-with-retry.js';
import { iterateZipJsonEntries } from '../zip-reader.js';
import { extractCvss } from './osv.js';
import type { VulnerabilityRecord } from '../types.js';

const LINUX_OSV_ZIP_URL = 'https://storage.googleapis.com/osv-vulnerabilities/Linux/all.zip';

interface OsvEvent {
  introduced?: string;
  fixed?: string;
  limit?: string;
}

interface OsvRange {
  type?: string;
  repo?: string;
  events?: OsvEvent[];
}

interface OsvAffected {
  package?: {
    ecosystem?: string;
    name?: string;
  };
  ranges?: OsvRange[];
}

interface OsvSeverity {
  type: string;
  score: string;
}

interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  published?: string;
  modified?: string;
  aliases?: string[];
  severity?: OsvSeverity[];
  affected?: OsvAffected[];
  references?: Array<{ url: string; type?: string }>;
}

export function osvToRecord(vuln: OsvVulnerability): VulnerabilityRecord | null {
  // Extract and canonicalise CVE ID to uppercase
  const rawCveId =
    (vuln.aliases ?? []).find((a) => /^CVE-\d{4}-\d{4,}$/i.test(a)) ??
    (/^CVE-\d{4}-\d{4,}$/i.test(vuln.id) ? vuln.id : undefined);

  if (!rawCveId) return null;
  const cveId = rawCveId.toUpperCase();

  const discoveredDate = parseDate(vuln.published ?? vuln.modified);
  if (!discoveredDate) return null;

  // The Linux kernel OSV entries identify fix commits and affected versions,
  // not an independent patch release timestamp. We intentionally leave
  // patchedDate undefined rather than deriving it from OSV metadata timestamps
  // (such as vuln.modified), which would fabricate artificial patch lags.
  const cvss = extractCvss(vuln.severity);
  const rawTitle = vuln.summary?.trim() || vuln.details?.split('\n')[0]?.trim();
  const title = (rawTitle || `Linux kernel vulnerability ${cveId}`).slice(0, 200);

  const advisoryRef = vuln.references?.find(
    (r) => r.type === 'ADVISORY' || r.type === 'WEB',
  );

  return buildRecord({
    id: cveId,
    source: 'linux',
    manufacturer: 'Linux',
    product: 'Linux Kernel',
    title,
    cvss,
    discoveredDate,
    publishedDate: parseDate(vuln.published),
    patchedDate: undefined,
    cveIds: [cveId],
    rawUrl: advisoryRef?.url ?? `https://www.cve.org/CVERecord?id=${cveId}`,
  });
}

export function parseLinuxVulns(osvVulns: Iterable<OsvVulnerability>): VulnerabilityRecord[] {
  const records: VulnerabilityRecord[] = [];
  const seen = new Set<string>();

  for (const vuln of osvVulns) {
    const rec = osvToRecord(vuln);
    if (!rec) continue;
    if (seen.has(rec.id)) continue;
    seen.add(rec.id);
    records.push(rec);
  }
  return records;
}

export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Linux (Kernel): downloading OSV bulk archive...');
  const response = await fetchWithRetry(LINUX_OSV_ZIP_URL, {
    headers: { 'User-Agent': 'VulnTrends/0.1' },
    timeoutMs: 60_000,
  });

  if (!response.ok) {
    throw new Error(`Linux OSV zip fetch failed: HTTP ${response.status}`);
  }

  console.log('Linux (Kernel): streaming records from zip...');
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const records = parseLinuxVulns(iterateZipJsonEntries<OsvVulnerability>(buffer));
  console.log(`Linux (Kernel): ${records.length} records extracted`);
  return records;
}
