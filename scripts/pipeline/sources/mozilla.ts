/**
 * Mozilla Foundation Security Advisories (MFSA) parser.
 *
 * Mozilla publishes security advisories at:
 *   https://www.mozilla.org/en-US/security/advisories/
 *
 * Each advisory page has an associated JSON endpoint. This parser fetches the
 * advisory index, then fetches each advisory's JSON to extract vulnerability
 * records with discovery and patch dates.
 */

import { buildRecord, parseDate } from '../normalise.js';
import { fetchWithRetry } from '../fetch-with-retry.js';
import type { VulnerabilityRecord } from '../types.js';

const MFSA_INDEX_URL = 'https://www.mozilla.org/en-US/security/advisories/';

interface MfsaAdvisory {
  id: string;
  title: string;
  url: string;
  date: string;
}

/**
 * Fetch the MFSA index page and extract advisory links.
 * The index page lists advisories with links to individual advisory pages.
 */
async function fetchAdvisoryIndex(): Promise<MfsaAdvisory[]> {
  const response = await fetchWithRetry(MFSA_INDEX_URL, {
    headers: { 'User-Agent': 'VulnTrends/0.1 (https://github.com/vulntrends)' },
  });
  if (!response.ok) {
    throw new Error(`MFSA index fetch failed: ${response.status}`);
  }
  const html = await response.text();

  // Parse advisory links — they match /en-US/security/advisories/mfsaYYYY-NN/
  const advisories: MfsaAdvisory[] = [];
  const linkRegex =
    /href="(\/en-US\/security\/advisories\/(mfsa\d{4}-\d{2,3})\/?)"[^>]*>([^<]*)</gi;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = linkRegex.exec(html)) !== null) {
    const id = match[2].toUpperCase();
    if (seen.has(id)) continue;
    seen.add(id);
    advisories.push({
      id,
      title: match[3].trim(),
      url: `https://www.mozilla.org${match[1]}`,
      date: '',
    });
  }

  return advisories;
}

/**
 * Fetch a single MFSA advisory page and extract vulnerability records.
 * Advisory pages contain CVE IDs, severity, and dates.
 */
async function fetchAdvisoryRecords(advisory: MfsaAdvisory): Promise<VulnerabilityRecord[]> {
  try {
    const response = await fetchWithRetry(advisory.url, {
      headers: { 'User-Agent': 'VulnTrends/0.1 (https://github.com/vulntrends)' },
    });
    if (!response.ok) {
      console.warn(`  MFSA: skip ${advisory.id} — HTTP ${response.status}`);
      return [];
    }
    const html = await response.text();

    // Extract the advisory date — typically in the page header
    // Look for patterns like "January 7, 2025" or ISO dates
    const dateMatch =
      html.match(/<p class="advisory-date">([^<]+)<\/p>/i) ??
      html.match(/"datePublished"\s*:\s*"([^"]+)"/i) ??
      html.match(/(\w+ \d{1,2}, \d{4})/);
    const patchedDate = parseDate(dateMatch?.[1]);
    // Skip advisories with no parseable date — falling back to "today"
    // would inject future-dated points and distort time-series aggregates.
    if (!patchedDate) {
      console.warn(`  MFSA: skip ${advisory.id} — no parseable date`);
      return [];
    }

    // Extract CVE IDs and vulnerability titles from the page
    const records: VulnerabilityRecord[] = [];
    const cveRegex = /CVE-\d{4}-\d{4,}/gi;
    const cveMatches = html.match(cveRegex);
    const cveIds = cveMatches ? [...new Set(cveMatches.map((m) => m.toUpperCase()))] : [];

    if (cveIds.length === 0) {
      // Some advisories don't list individual CVEs — create one record per advisory
      // Fall back to the advisory ID when the HTML link text is empty
      records.push(
        buildRecord({
          id: advisory.id,
          source: 'mozilla',
          manufacturer: 'Mozilla',
          title: advisory.title || advisory.id,
          discoveredDate: patchedDate,
          patchedDate,
          cveIds: undefined,
          rawUrl: advisory.url,
        }),
      );
    } else {
      // Create a record for the advisory (covering all CVEs)
      records.push(
        buildRecord({
          id: advisory.id,
          source: 'mozilla',
          manufacturer: 'Mozilla',
          title: advisory.title || advisory.id,
          discoveredDate: patchedDate,
          patchedDate,
          cveIds,
          rawUrl: advisory.url,
        }),
      );
    }

    return records;
  } catch (err) {
    console.warn(`  MFSA: error fetching ${advisory.id}:`, err);
    return [];
  }
}

/**
 * Fetch all Mozilla MFSA vulnerability records.
 */
export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Mozilla MFSA: fetching advisory index...');
  const advisories = await fetchAdvisoryIndex();
  console.log(`Mozilla MFSA: found ${advisories.length} advisories`);

  const allRecords: VulnerabilityRecord[] = [];
  // Process in small batches to be polite
  const batchSize = 5;
  for (let i = 0; i < advisories.length; i += batchSize) {
    const batch = advisories.slice(i, i + batchSize);
    const batchRecords = await Promise.all(batch.map(fetchAdvisoryRecords));
    allRecords.push(...batchRecords.flat());
    if (i + batchSize < advisories.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(`Mozilla MFSA: ${allRecords.length} records extracted`);
  return allRecords;
}
