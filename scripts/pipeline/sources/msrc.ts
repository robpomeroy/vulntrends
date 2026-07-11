/**
 * Microsoft Security Response Center (MSRC) parser.
 *
 * MSRC provides a CVRF (Common Vulnerability Reporting Framework) API at:
 *   https://api.msrc.microsoft.com/cvrf/v3.0/
 *
 * The API returns structured JSON for security updates. This parser fetches
 * the list of updates, then fetches each update's CVRF document to extract
 * vulnerability records with patch dates.
 */

import { buildRecord, parseDate } from '../normalise.js';
import type { VulnerabilityRecord } from '../types.js';

const MSRC_API_BASE = 'https://api.msrc.microsoft.com/cvrf/v3.0';
const MSRC_API_KEY = process.env.MSRC_API_KEY;

interface CvrfUpdate {
  ID: string;
  Alias: string;
  DocumentTitle: string;
  CurrentReleaseDate: string;
}

interface CvrfDocument {
  docType: string;
  docTitle: string;
  docPublished: string;
  docModified: string;
  vulnList: Array<{
    CVE: string;
    Title: string;
    Notes?: Array<{ Title: string; Value: string }>;
    CVSSScoreSet?: { BaseScore: string };
    ProductStatuses?: Array<{ ProductID: string[] }>;
  }>;
}

/**
 * Fetch the list of available CVRF updates.
 */
async function fetchUpdateList(): Promise<CvrfUpdate[]> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'VulnTrends/0.1',
  };
  if (MSRC_API_KEY) {
    headers['Api-Key'] = MSRC_API_KEY;
  }

  const response = await fetch(`${MSRC_API_BASE}/updates`, { headers });
  if (!response.ok) {
    throw new Error(`MSRC update list fetch failed: ${response.status}`);
  }
  const data = await response.json();
  return data.value ?? [];
}

/**
 * Fetch a single CVRF document and extract vulnerability records.
 */
async function fetchCvrfRecords(update: CvrfUpdate): Promise<VulnerabilityRecord[]> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'VulnTrends/0.1',
    };
    if (MSRC_API_KEY) {
      headers['Api-Key'] = MSRC_API_KEY;
    }

    const response = await fetch(`${MSRC_API_BASE}/cvrf/${update.ID}`, { headers });
    if (!response.ok) {
      console.warn(`  MSRC: skip ${update.ID} — HTTP ${response.status}`);
      return [];
    }
    const data = await response.json();

    const patchedDate = parseDate(update.CurrentReleaseDate);
    // MSRC records use the patch date as the discovery-date proxy. If it
    // can't be parsed, skip this update rather than injecting "today"
    // (which would skew aggregates and produce future-dated points).
    if (!patchedDate) {
      console.warn(`  MSRC: skip ${update.ID} — unparseable CurrentReleaseDate`);
      return [];
    }
    const records: VulnerabilityRecord[] = [];

    // The CVRF document contains a vulnerability list
    const vulns = data?.cvrfDocument?.VulnerabilityList ?? data?.vulnList ?? [];

    for (const vuln of vulns) {
      const cveId = vuln.CVE ?? vuln.title?.match(/CVE-\d{4}-\d{4,}/i)?.[0];
      if (!cveId) continue;

      const title = vuln.Title ?? cveId;
      const cvss = vuln.CVSSScoreSet?.BaseScore
        ? parseFloat(vuln.CVSSScoreSet.BaseScore)
        : undefined;

      // MSRC doesn't provide discovery dates — use the patch date as a proxy
      records.push(
        buildRecord({
          id: cveId,
          source: 'msrc',
          manufacturer: 'Microsoft',
          title: typeof title === 'string' ? title : cveId,
          cvss,
          discoveredDate: patchedDate,
          patchedDate,
          cveIds: [cveId],
          rawUrl: `https://msrc.microsoft.com/update-guide/vulnerability/${cveId}`,
        }),
      );
    }

    return records;
  } catch (err) {
    console.warn(`  MSRC: error fetching ${update.ID}:`, err);
    return [];
  }
}

/**
 * Fetch all Microsoft MSRC vulnerability records.
 */
export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Microsoft MSRC: fetching update list...');
  const updates = await fetchUpdateList();
  console.log(`Microsoft MSRC: found ${updates.length} updates`);

  const allRecords: VulnerabilityRecord[] = [];
  const batchSize = 3;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const batchRecords = await Promise.all(batch.map(fetchCvrfRecords));
    allRecords.push(...batchRecords.flat());
    if (i + batchSize < updates.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  console.log(`Microsoft MSRC: ${allRecords.length} records extracted`);
  return allRecords;
}
