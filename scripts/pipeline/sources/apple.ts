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
import { fetchWithRetry } from '../fetch-with-retry.js';
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
 *
 * As of 2026 the page uses a single `<table class="gb-table">` whose
 * rows have three cells: a link+name (e.g. "iOS 26.5.2 and iPadOS
 * 26.5.2" linking to /en-us/127594), the device list, and a release
 * date in the format "29 Jun 2026". The earlier HT\d{6,9} ID pattern
 * is no longer present, so the table-row walker is now the primary
 * strategy. We keep a relaxed HT-ID regex as a fallback in case Apple
 * reverts the layout.
 */
async function fetchAdvisoryIndex(): Promise<AppleAdvisory[]> {
  const response = await fetchWithRetry(APPLE_ADVISORIES_URL, {
    headers: { 'User-Agent': 'VulnTrends/0.1 (https://github.com/vulntrends)' },
  });
  if (!response.ok) {
    throw new Error(`Apple index fetch failed: ${response.status}`);
  }
  const html = await response.text();

  const advisories: AppleAdvisory[] = [];
  const seen = new Set<string>();

  // Strategy 1: walk the advisory table. The table is the only
  // `<table class="gb-table">` on the page; its rows each link to an
  // individual advisory with a numeric support article ID.
  const tableMatch = html.match(/<table[^>]*class="gb-table"[^>]*>([\s\S]*?)<\/table>/i);
  if (tableMatch) {
    const tableBody = tableMatch[1];
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(tableBody)) !== null) {
      const row = rowMatch[1];
      // The link cell is the first <td>; the date cell is the third.
      const linkMatch = row.match(
        /<a\b[^>]*href="(https:\/\/support\.apple\.com\/en-us\/(\d+))"[^>]*>([\s\S]*?)<\/a>/i,
      );
      if (!linkMatch) continue;
      const url = linkMatch[1];
      const numericId = linkMatch[2];
      const rawTitle = linkMatch[3];
      // Title text in the new layout sits inside one or more <p>
      // tags. Strip tags and collapse whitespace.
      const title = rawTitle.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || numericId;

      // Date cell: third <td>. Apple formats it as "29 Jun 2026".
      const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
      const cells: string[] = [];
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(row)) !== null) {
        cells.push(cellMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
      }
      const dateText = cells[2];

      // Use the numeric ID as the advisory key — it's stable and
      // unique. The old HT\d{6,9} IDs are no longer used.
      if (seen.has(numericId)) continue;
      seen.add(numericId);

      // Normalise the date to ISO (YYYY-MM-DD) for the record field.
      const isoDate = normaliseAppleDate(dateText);

      advisories.push({
        id: numericId,
        title,
        url,
        date: isoDate,
        cveIds: [],
      });
    }
  }
  if (advisories.length > 0) return advisories;

  // Strategy 2: relaxed HT\d{6,9} pattern, in case Apple ever reverts
  // to the old layout. Mirrors the previous parser's fallback.
  console.warn('  Apple: primary table pattern found no advisories, trying fallback...');
  const fallbackRegex = /href="([^"]*HT\d{6,9}[^"]*)"[^>]*>([^<]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = fallbackRegex.exec(html)) !== null) {
    const url = match[1];
    const idMatch = url.match(/HT\d{6,9}/);
    if (!idMatch) continue;
    const id = idMatch[0];
    if (seen.has(id)) continue;
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

  return advisories;
}

/**
 * Convert an Apple "Release date" cell value ("29 Jun 2026", "5 Jul 2026")
 * to ISO `YYYY-MM-DD`. Returns `undefined` if the value can't be parsed.
 * The en-GB locale matches Apple's published format.
 */
function normaliseAppleDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const d = new Date(`${raw} UTC`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch a single Apple advisory page and extract vulnerability records.
 *
 * The release date is taken from the index table when available
 * (parsed in `fetchAdvisoryIndex`), and only falls back to per-page
 * extraction when the index didn't supply one. The per-page strategies
 * are kept as a defensive measure in case Apple's individual advisory
 * pages still use JSON-LD / `<time>` tags that the index dropped.
 */
async function fetchAdvisoryRecords(advisory: AppleAdvisory): Promise<VulnerabilityRecord[]> {
  // Date from the index table — primary source. `advisory.date` is
  // already in ISO `YYYY-MM-DD` form (or undefined if the cell was
  // missing or unparseable).
  let patchedDate = advisory.date ? parseDate(advisory.date) : undefined;

  let html = '';
  try {
    const response = await fetchWithRetry(advisory.url, {
      headers: { 'User-Agent': 'VulnTrends/0.1 (https://github.com/vulntrends)' },
    });
    if (!response.ok) {
      // If we already have a date from the index, don't bail out —
      // we can still emit a record using the index date.
      if (!patchedDate) {
        console.warn(`  Apple: skip ${advisory.id} — HTTP ${response.status}`);
        return [];
      }
      html = '';
    } else {
      html = await response.text();
    }
  } catch (err) {
    // If we already have a date, proceed with index date only — the
    // CVE-ID extraction below needs the page, but a no-CVE advisory
    // record can still be emitted if the page fetch failed.
    if (!patchedDate) {
      console.warn(`  Apple: error fetching ${advisory.id}:`, err);
      return [];
    }
    html = '';
  }

  if (!patchedDate) {
    // Strategy 1: JSON-LD datePublished / dateModified
    const dateMatch =
      html.match(/"datePublished"\s*:\s*"([^"]+)"/i) ??
      html.match(/"dateModified"\s*:\s*"([^"]+)"/i) ??
      // Strategy 2: <time datetime="...">
      html.match(/<time[^>]*datetime="([^"]+)"/i) ??
      // Strategy 3: "Posted: Month DD, YYYY"
      html.match(/Posted:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/i);
    const fallback = parseDate(dateMatch?.[1]);
    if (!fallback) {
      console.warn(`  Apple: skip ${advisory.id} — no parseable date`);
      return [];
    }
    patchedDate = fallback;
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
