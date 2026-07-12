/**
 * Apple security advisories parser — defensive with NVD fallback.
 *
 * Apple publishes security advisories at:
 *   https://support.apple.com/en-us/HT201222
 *
 * These pages are HTML-only and Apple may change their structure at any time.
 * This parser is deliberately defensive: it uses multiple extraction
 * strategies, logs warnings on parse failures, and falls back to NVD data
 * for Apple-related CVEs when scraping fails entirely.
 *
 * Snapshot tests should be maintained alongside this parser to catch
 * structural changes in Apple's HTML.
 */

import { buildRecord, extractCveIds, parseDate } from '../normalise.js';
import type { VulnerabilityRecord } from '../types.js';

const APPLE_ADVISORIES_URL = 'https://support.apple.com/en-us/HT201222';

interface AppleAdvisory {
  id: string; // e.g. "HT213XXX" or the advisory title
  title: string;
  url: string;
  date: string | undefined;
  cveIds: string[];
}

/**
 * Fetch the Apple security updates index page.
 * This page lists all security advisories with links to individual pages.
 */
async function fetchAdvisoryIndex(): Promise<AppleAdvisory[]> {
  const response = await fetch(APPLE_ADVISORIES_URL, {
    headers: { 'User-Agent': 'VulnTrends/0.1 (https://github.com/vulntrends)' },
  });
  if (!response.ok) {
    throw new Error(`Apple index fetch failed: ${response.status}`);
  }
  const html = await response.text();

  const advisories: AppleAdvisory[] = [];
  const seen = new Set<string>();

  // Strategy 1: Look for links to /en-us/HTXXXXXX pages (Apple's advisory IDs)
  // Apple advisory links typically point to support articles like /en-us/HT213123
  const linkRegex =
    /href="(https:\/\/support\.apple\.com\/en-us\/(HT\d{6,9})[^"]*)"[^>]*>([^<]+)</gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const id = match[2];
    if (seen.has(id)) continue;
    seen.add(id);
    // Fall back to the advisory ID when the HTML link text is empty,
    // so the title is always non-empty per the Zod schema contract.
    const title = match[3].trim() || id;
    advisories.push({
      id,
      title,
      url: match[1],
      date: undefined,
      cveIds: [],
    });
  }

  // Strategy 2: If Strategy 1 found nothing, try a more relaxed pattern
  if (advisories.length === 0) {
    console.warn('  Apple: primary link pattern found no advisories, trying fallback...');
    const fallbackRegex =
      /href="([^"]*HT\d{6,9}[^"]*)"[^>]*>([^<]+)/gi;
    while ((match = fallbackRegex.exec(html)) !== null) {
      const url = match[1];
      const idMatch = url.match(/HT\d{6,9}/);
      if (!idMatch) continue;
      const id = idMatch[0];
      if (seen.has(id)) continue;
      // Fall back to the advisory ID when the HTML link text is empty.
      const title = match[2].trim() || id;
      seen.add(id);
      advisories.push({
        id,
        title,
        url: url.startsWith('http') ? url : `https://support.apple.com${url}`,
        date: undefined,
        cveIds: [],
      });
    }
  }

  return advisories;
}

/**
 * Fetch a single Apple advisory page and extract vulnerability records.
 * Uses multiple strategies to find dates and CVE IDs.
 */
async function fetchAdvisoryRecords(advisory: AppleAdvisory): Promise<VulnerabilityRecord[]> {
  try {
    const response = await fetch(advisory.url, {
      headers: { 'User-Agent': 'VulnTrends/0.1 (https://github.com/vulntrends)' },
    });
    if (!response.ok) {
      console.warn(`  Apple: skip ${advisory.id} — HTTP ${response.status}`);
      return [];
    }
    const html = await response.text();

    // Strategy 1: Look for JSON-LD structured data with datePublished
    const dateMatch =
      html.match(/"datePublished"\s*:\s*"([^"]+)"/i) ??
      html.match(/"dateModified"\s*:\s*"([^"]+)"/i) ??
      // Strategy 2: Look for human-readable dates near the top of the article
      html.match(/<time[^>]*datetime="([^"]+)"/i) ??
      // Strategy 3: Look for "Posted: Month DD, YYYY" pattern
      html.match(/Posted:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/i);
    const patchedDate = parseDate(dateMatch?.[1]);
    // Skip advisories with no parseable date — falling back to "today"
    // would inject future-dated points and distort time-series aggregates.
    if (!patchedDate) {
      console.warn(`  Apple: skip ${advisory.id} — no parseable date`);
      return [];
    }

    // Extract CVE IDs from the page
    const cveIds = extractCveIds(html) ?? [];

    // Fall back to the advisory ID when the HTML link text is empty
    const baseTitle = advisory.title || advisory.id;

    if (cveIds.length === 0) {
      // No CVEs listed — create one record for the advisory
      return [
        buildRecord({
          id: advisory.id,
          source: 'apple',
          manufacturer: 'Apple',
          title: baseTitle,
          discoveredDate: patchedDate,
          patchedDate,
          rawUrl: advisory.url,
        }),
      ];
    }

    // Create one record per CVE (Apple advisories often cover multiple CVEs)
    return cveIds.map((cveId) =>
      buildRecord({
        id: cveId,
        source: 'apple',
        manufacturer: 'Apple',
        title: `${baseTitle} — ${cveId}`,
        discoveredDate: patchedDate,
        patchedDate,
        cveIds: [cveId],
        rawUrl: advisory.url,
      }),
    );
  } catch (err) {
    console.warn(`  Apple: error fetching ${advisory.id}:`, err);
    return [];
  }
}

/**
 * Fetch all Apple vulnerability records.
 *
 * If scraping fails entirely (index page unreachable or no advisories found),
 * returns an empty array. The pipeline orchestrator will then rely on NVD
 * data for Apple-related CVEs as a fallback.
 */
export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Apple: fetching advisory index...');

  let advisories: AppleAdvisory[];
  try {
    advisories = await fetchAdvisoryIndex();
  } catch (err) {
    console.warn(`Apple: index fetch failed — will rely on NVD fallback:`, err);
    return [];
  }

  if (advisories.length === 0) {
    console.warn('Apple: no advisories found — will rely on NVD fallback');
    return [];
  }

  console.log(`Apple: found ${advisories.length} advisories`);

  const allRecords: VulnerabilityRecord[] = [];
  const batchSize = 5;

  for (let i = 0; i < advisories.length; i += batchSize) {
    const batch = advisories.slice(i, i + batchSize);
    const batchRecords = await Promise.all(batch.map(fetchAdvisoryRecords));
    allRecords.push(...batchRecords.flat());
    if (i + batchSize < advisories.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log(`Apple: ${allRecords.length} records extracted`);
  return allRecords;
}
