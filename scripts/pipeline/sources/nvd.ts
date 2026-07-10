/**
 * NVD (National Vulnerability Database) / CVE parser.
 *
 * NVD provides a REST API at:
 *   https://services.nvd.nist.gov/rest/json/cves/2.0
 *
 * This is the canonical cross-vendor source. It requires an API key
 * (NVD_API_KEY) for reasonable rate limits. Without a key, requests are
 * limited to ~1 per 6 seconds.
 */

import { buildRecord, cvssToSeverity, parseDate } from '../normalise.js';
import type { VulnerabilityRecord } from '../types.js';

const NVD_API_URL = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const NVD_API_KEY = process.env.NVD_API_KEY;

/** Manufacturers we care about — used to filter NVD's broad dataset. */
const TARGET_MANUFACTURERS = [
  'mozilla',
  'google',
  'chrome',
  'microsoft',
  'apple',
  'oracle',
  'samsung',
  'linux',
  'linux_kernel',
  'linux kernel',
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
 * Determine the manufacturer from CPE configuration data.
 * CPE format: cpe:2.3:a:vendor:product:version
 */
function extractManufacturerFromCpe(cve: NvdCve): string | undefined {
  const configs = cve.configurations ?? [];
  for (const config of configs) {
    for (const node of config.nodes ?? []) {
      for (const match of node.cpeMatch ?? []) {
        if (!match.vulnerable) continue;
        const parts = match.criteria.split(':');
        // cpe:2.3:a:vendor:product:...
        const vendor = parts[3]?.toLowerCase();
        if (!vendor) continue;
        if (TARGET_MANUFACTURERS.includes(vendor)) {
          return vendor;
        }
      }
    }
  }
  return undefined;
}

/**
 * Normalise a vendor name from CPE to our canonical manufacturer names.
 */
function normaliseVendor(vendor: string): string {
  const v = vendor.toLowerCase().trim();
  if (v === 'mozilla') return 'Mozilla';
  if (v === 'google' || v === 'chrome') return 'Google';
  if (v === 'microsoft') return 'Microsoft';
  if (v === 'apple') return 'Apple';
  if (v === 'oracle') return 'Oracle';
  if (v === 'samsung') return 'Samsung';
  if (v === 'linux' || v === 'linux_kernel') return 'Linux';
  return vendor;
}

/**
 * Fetch a single page of CVEs from the NVD API.
 */
async function fetchCvePage(startIndex: number): Promise<NvdResponse> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'VulnTrends/0.1',
  };
  if (NVD_API_KEY) {
    headers['apiKey'] = NVD_API_KEY;
  }

  const params = new URLSearchParams({
    startIndex: String(startIndex),
    resultsPerPage: '2000',
  });

  const response = await fetch(`${NVD_API_URL}?${params}`, { headers });
  if (!response.ok) {
    throw new Error(`NVD API returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

/**
 * Convert an NVD CVE entry to a VulnerabilityRecord.
 * Only returns records for our target manufacturers.
 */
function cveToRecord(cve: NvdCve): VulnerabilityRecord | null {
  const vendor = extractManufacturerFromCpe(cve);
  if (!vendor) return null;

  const manufacturer = normaliseVendor(vendor);
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

/**
 * Fetch all NVD vulnerability records for our target manufacturers.
 *
 * Note: The NVD API can return a very large number of CVEs. We paginate
 * through all results, filtering to our target manufacturers client-side.
 */
export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('NVD/CVE: fetching CVEs...');
  if (!NVD_API_KEY) {
    console.warn('  NVD: No NVD_API_KEY set — rate limits will be aggressive (1 req/6s)');
  }

  const allRecords: VulnerabilityRecord[] = [];
  let startIndex = 0;
  let totalResults = Infinity;

  while (startIndex < totalResults) {
    const data = await fetchCvePage(startIndex);
    totalResults = data.totalResults;

    for (const vuln of data.vulnerabilities) {
      const record = cveToRecord(vuln.cve);
      if (record) allRecords.push(record);
    }

    startIndex += data.resultsPerPage;
    console.log(
      `  NVD: fetched ${startIndex}/${totalResults} (${allRecords.length} matching)`,
    );

    if (startIndex < totalResults) {
      // Rate limit: 500ms with API key, 6s without
      const delay = NVD_API_KEY ? 500 : 6000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  console.log(`NVD/CVE: ${allRecords.length} records extracted`);
  return allRecords;
}
