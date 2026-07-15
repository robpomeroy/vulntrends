/**
 * Fortinet PSIRT (Product Security Incident Response Team) advisories parser.
 *
 * Fortinet publishes advisories at https://www.fortiguard.com/psirt. The
 * site is a server-rendered HTML listing (not Angular-only — the first page
 * is server-rendered and contains all the data we need; subsequent pages
 * also work as plain HTML GETs).
 *
 * Each row contains:
 *   - FG-IR ID (internal ID, e.g. "FG-IR-25-1052") — also the URL slug
 *   - Advisory title
 *   - One or more CVE IDs
 *   - Affected products and version ranges
 *   - Two dates: "Updated" (when the advisory was last revised, used as
 *     patchedDate) and "Published" (when it was first released, used as
 *     discoveredDate). The Updated date is later than Published, giving
 *     us a real patch-lag signal.
 *   - Severity, component, attack type
 *
 * Pagination: the listing shows 300 advisories across ~20 pages, navigated
 * via `?page=N` query parameter. We follow until we get an empty page.
 */

import { buildRecord, extractCveIds, parseDate } from '../normalise.js';
import { fetchWithRetry } from '../fetch-with-retry.js';
import type { VulnerabilityRecord } from '../types.js';

const FORTINET_PSIRT_URL = 'https://www.fortiguard.com/psirt';
const PAGE_SIZE = 15; // observed in the HTML (15 rows per page)

const SEVERITY_MAP: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
  Critical: 'critical',
  High: 'high',
  Medium: 'medium',
  Low: 'low',
  Informational: 'low',
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface FortinetAdvisory {
  id: string; // FG-IR-XX-XXXX
  url: string;
  title: string;
  cveIds: string[];
  product?: string;
  updatedDate?: string; // patchedDate
  publishedDate?: string; // discoveredDate
  severity?: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Parse one advisory row. The row HTML looks like:
 *
 *   <div class="row" onclick="location.href = '/psirt/FG-IR-25-1052'">
 *     <div class="col-md-3">
 *       <b>FG-IR-25-1052 LDAP authentication bypass in Agentless VPN and FSSO</b>
 *       <br>
 *       <b class="cve">CVE-2026-22153</b>
 *     </div>
 *     <div class="col-md-2"><small>Description...</small></div>
 *     <div class="col-md-2"><small class="item">
 *       <span class="item-group">
 *         <b>FortiOS</b>
 *         <span class="item-sub">7.6.4, 7.6.3, ...</span>
 *       </span>
 *     </small></div>
 *     <div class="col d-none d-lg-block">
 *       <p><b>Jul 04, 2026</b></p>
 *       <small><b>Published:</b> <br>Feb 10, 2026</small>
 *     </div>
 *     ...
 *   </div>
 */
function parseRow(rowHtml: string): FortinetAdvisory | null {
  // FG-IR ID and link target
  const linkMatch = rowHtml.match(/location\.href\s*=\s*'\/psirt\/(FG-IR-[\w-]+)'/);
  if (!linkMatch) return null;
  const id = linkMatch[1];

  // Title (first <b> after the col-md-3 opener)
  const titleMatch = rowHtml.match(/<b>\s*(FG-IR-[\w-]+)\s+([^<]+?)\s*<\/b>/);
  if (!titleMatch) return null;
  const title = titleMatch[2].trim();

  // CVE IDs (one or more — Fortinet may list several per advisory)
  const cveIds = extractCveIds(rowHtml) ?? [];

  // Product: the first <b> inside an item-group
  const productMatch = rowHtml.match(/<span class="item-group">\s*<b>([^<]+)<\/b>/);
  const product = productMatch?.[1].trim();

  // Dates: Updated and Published are in a div with d-none d-lg-block
  // The pattern is: <p><b>Jul 04, 2026</b></p>\n<small><b>Published:</b> <br>Feb 10, 2026</small>
  const updatedMatch = rowHtml.match(/<p><b>([A-Z][a-z]{2} \d{1,2}, \d{4})<\/b><\/p>/);
  const publishedMatch = rowHtml.match(/<b>Published:<\/b>\s*(?:<br>\s*)?([A-Z][a-z]{2} \d{1,2}, \d{4})/);
  const updatedDate = updatedMatch ? parseDate(updatedMatch[1]) : undefined;
  const publishedDate = publishedMatch ? parseDate(publishedMatch[1]) : undefined;

  // Severity (last <b>...</b> in the row before the closing divs)
  const severityMatch = rowHtml.match(/<b>(Critical|High|Medium|Low|Informational)<\/b>\s*(?:Severity|Attack Type|Component|Discovered)/i);
  let severity: FortinetAdvisory['severity'];
  if (severityMatch) {
    severity = SEVERITY_MAP[severityMatch[1]] ?? undefined;
  }

  return {
    id,
    url: `${FORTINET_PSIRT_URL}/${id}`,
    title,
    cveIds,
    product,
    updatedDate,
    publishedDate,
    severity,
  };
}

/** Fetch one HTML page from the Fortinet PSIRT listing. */
async function fetchPage(page: number): Promise<string> {
  // The base URL already carries the empty filter params, but they
  // don't matter — the page param is what controls pagination.
  const url = `${FORTINET_PSIRT_URL}?date=&severity=&product=&component=&discovered=&attack_type=&version=&page=${page}`;
  const response = await fetchWithRetry(url, {
    headers: { 'User-Agent': 'VulnTrends/0.1 (https://github.com/vulntrends)' },
  });
  if (!response.ok) {
    throw new Error(`Fortinet PSIRT page ${page} fetch failed: ${response.status}`);
  }
  return response.text();
}

/** Extract all advisory rows from a page. */
function extractRows(html: string): string[] {
  // Each row is a <div class="row" onclick="location.href = '/psirt/FG-IR-...'">.
  // The whole row contains all the columns concatenated together.
  const rowRegex = /<div class="row"\s+onclick="location\.href\s*=\s*'\/psirt\/[^']+'">[\s\S]*?(?=<div class="row"\s+onclick|$)/gi;
  return html.match(rowRegex) ?? [];
}

export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Fortinet: fetching PSIRT advisories...');
  const records: VulnerabilityRecord[] = [];
  const seen = new Set<string>();
  let lastPageCount = PAGE_SIZE;

  // Follow pagination until we get an empty page (or a page with fewer
  // rows than expected after the first — that's the last page).
  for (let page = 1; page <= 50 && lastPageCount > 0; page++) {
    let html: string;
    try {
      html = await fetchPage(page);
    } catch (err) {
      console.warn(`  Fortinet: skip page ${page} —`, err);
      break;
    }
    const rows = extractRows(html);
    if (rows.length === 0) break;
    lastPageCount = rows.length;
    for (const row of rows) {
      const adv = parseRow(row);
      if (!adv) continue;
      // Dedupe by FG-IR ID
      if (seen.has(adv.id)) continue;
      seen.add(adv.id);

      // Fortinet only publishes updated/published dates, not a separate
      // discovery date. Use the original "Published" date as
      // discoveredDate and the "Updated" date as patchedDate — this
      // gives us a real (and meaningful) patch-lag signal.
      const date = adv.publishedDate ?? adv.updatedDate;
      if (!date) continue;

      // Pick the first CVE ID as the record ID, fall back to FG-IR.
      const recordId = adv.cveIds[0] ?? adv.id;

      records.push(
        buildRecord({
          id: recordId,
          source: 'fortinet',
          manufacturer: 'Fortinet',
          product: adv.product,
          title: adv.title,
          severity: adv.severity,
          discoveredDate: adv.publishedDate ?? date,
          publishedDate: adv.publishedDate,
          patchedDate: adv.updatedDate,
          cveIds: adv.cveIds.length > 0 ? adv.cveIds : undefined,
          rawUrl: adv.url,
        }),
      );
    }
    // Polite pause between pages
    if (rows.length >= PAGE_SIZE) {
      await sleep(500);
    }
  }

  console.log(`  Fortinet: parsed ${records.length} advisories`);
  return records;
}
