/**
 * NVD (National Vulnerability Database) / CVE parser.
 *
 * NVD provides a REST API at:
 *   https://services.nvd.nist.gov/rest/json/cves/2.0
 *
 * This is the canonical cross-vendor source. It requires an API key
 * (NVD_API_KEY) for reasonable rate limits. Without a key, requests are
 * limited to ~1 per 6 seconds.
 *
 * To avoid downloading the entire NVD dataset (millions of CVEs), we use
 * the `virtualMatchString` parameter to filter server-side by CPE vendor.
 * Each vendor is queried separately, then results are merged and
 * deduplicated by CVE ID.
 */

import { buildRecord, cvssToSeverity, parseDate } from '../normalise.js';
import type { VulnerabilityRecord } from '../types.js';

const NVD_API_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const NVD_API_KEY = process.env.NVD_API_KEY;

/**
 * CPE vendor names to query via `virtualMatchString`.
 * Each entry maps a CPE vendor string to our canonical manufacturer name.
 * The CPE match string format is `cpe:2.3:a:<vendor>:*:*:*:*:*:*:*:*:*`
 * which matches all products from that vendor.
 */
const VENDOR_QUERIES: Array<{ cpeVendor: string; manufacturer: string }> = [
  { cpeVendor: 'mozilla', manufacturer: 'Mozilla' },
  { cpeVendor: 'google', manufacturer: 'Google' },
  { cpeVendor: 'chrome', manufacturer: 'Google' },
  { cpeVendor: 'microsoft', manufacturer: 'Microsoft' },
  { cpeVendor: 'apple', manufacturer: 'Apple' },
  { cpeVendor: 'oracle', manufacturer: 'Oracle' },
  { cpeVendor: 'samsung', manufacturer: 'Samsung' },
  { cpeVendor: 'linux', manufacturer: 'Linux' },
];

interface NvdCve {
  id: string;
  descriptions: Array<{ lang: string; value: string }>;
  published: string;
  lastModified: string;
  metrics?: {
    cvssMetricV31?: Array<{
      cvssData: { baseScore: number; baseSeverity: string };
    }>;
    cvssMetricV30?: Array<{
      cvssData: { baseScore: number; baseSeverity: string };
    }>;
  };
  references?: Array<{ url: string; tags?: string[] }>;
  weaknesses?: Array<{ description: Array<{ lang: string; value: string }> }>;
  configurations?: Array<{
    nodes: Array<{
      cpeMatch: Array<{
        criteria: string;
        vulnerable: boolean;
      }>;
    }>;
  }>;
}

interface NvdResponse {
  resultsPerPage: number;
  startIndex: number;
  totalResults: number;
  vulnerabilities: Array<{ cve: NvdCve }>;
}

/**
 * Fetch a single page of CVEs from the NVD API, filtered by CPE vendor.
 *
 * @param cpeVendor  The CPE 2.3 vendor string (e.g. "microsoft")
 * @param startIndex  Pagination offset
 */
async function fetchCvePage(
  cpeVendor: string,
  startIndex: number,
): Promise<NvdResponse> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'VulnTrends/0.1',
  };
  if (NVD_API_KEY) {
    headers['apiKey'] = NVD_API_KEY;
  }

  // virtualMatchString filters server-side by CPE vendor.
  // Format: cpe:2.3:a:<vendor>:*:*:*:*:*:*:*:*:*
  const matchString = `cpe:2.3:a:${cpeVendor}:*:*:*:*:*:*:*:*:*`;

  const params = new URLSearchParams({
    virtualMatchString: matchString,
    startIndex: String(startIndex),
    resultsPerPage: '2000',
  });

  const response = await fetch(`${NVD_API_URL}?${params}`, { headers });
  if (!response.ok) {
    throw new Error(
      `NVD API returned ${response.status} for vendor "${cpeVendor}": ${await response.text()}`,
    );
  }
  return response.json();
}

/**
 * Convert an NVD CVE entry to a VulnerabilityRecord.
 *
 * @param cve            The NVD CVE entry
 * @param manufacturer  The canonical manufacturer name (from the query)
 */
function cveToRecord(cve: NvdCve, manufacturer: string): VulnerabilityRecord | null {
  const description =
    cve.descriptions?.find((d) => d.lang === 'en')?.value ?? cve.id;
  const cvss =
    cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseScore ??
    cve.metrics?.cvssMetricV30?.[0]?.cvssData.baseScore;
  const severity = cvssToSeverity(cvss);

  // NVD's "published" date is when the CVE was published, not discovered.
  // We use it as the discoveredDate proxy since NVD doesn't track discovery.
  const discoveredDate = parseDate(cve.published);
  if (!discoveredDate) return null;

  // NVD doesn't have a "patched" date — lastModified may indicate a fix
  // but is unreliable. We leave patchedDate undefined for NVD records.
  const advisoryRef = cve.references?.find((r) =>
    r.tags?.includes('Vendor Advisory'),
  );

  return buildRecord({
    id: cve.id,
    source: 'nvd',
    manufacturer,
    title: description.length > 200 ? description.slice(0, 200) + '…' : description,
    severity,
    cvss,
    discoveredDate,
    cveIds: [cve.id],
    rawUrl: advisoryRef?.url ?? `https://nvd.nist.gov/vuln/detail/${cve.id}`,
  });
}

/** Sleep for the given milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch all NVD vulnerability records for our target manufacturers.
 *
 * Queries each CPE vendor separately via `virtualMatchString` to avoid
 * downloading the entire NVD dataset. Results are deduplicated by CVE ID
 * (since e.g. "google" and "chrome" may return overlapping CVEs).
 */
export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('NVD/CVE: fetching CVEs...');
  if (!NVD_API_KEY) {
    console.warn('  NVD: No NVD_API_KEY set — rate limits will be aggressive (1 req/6s)');
  }

  // Rate limit: 500ms with API key, 6s without
  const delay = NVD_API_KEY ? 500 : 6000;

  const seenIds = new Set<string>();
  const allRecords: VulnerabilityRecord[] = [];

  for (const { cpeVendor, manufacturer } of VENDOR_QUERIES) {
    console.log(`  NVD: querying vendor "${cpeVendor}" → ${manufacturer}...`);

    let startIndex = 0;
    let totalResults = Infinity;

    while (startIndex < totalResults) {
      const data = await fetchCvePage(cpeVendor, startIndex);
      totalResults = data.totalResults;

      for (const vuln of data.vulnerabilities) {
        // Deduplicate by CVE ID across vendor queries
        if (seenIds.has(vuln.cve.id)) continue;
        seenIds.add(vuln.cve.id);

        const record = cveToRecord(vuln.cve, manufacturer);
        if (record) allRecords.push(record);
      }

      startIndex += data.resultsPerPage;
      console.log(
        `    fetched ${startIndex}/${totalResults} for "${cpeVendor}" (${allRecords.length} total)`,
      );

      if (startIndex < totalResults) {
        await sleep(delay);
      }
    }

    // Pause between vendor queries
    await sleep(delay);
  }

  console.log(`NVD/CVE: ${allRecords.length} records extracted`);
  return allRecords;
}
