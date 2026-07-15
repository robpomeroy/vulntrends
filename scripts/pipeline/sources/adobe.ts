/**
 * Adobe Product Security Incident Response Team (PSIRT) advisories parser.
 *
 * Adobe publishes security bulletins (APSB-XX-YY format) at:
 *   https://helpx.adobe.com/security.html
 *
 * The page is a server-rendered HTML table with one row per bulletin:
 *
 *   | Product | Originally Published | Last Updated |
 *   | APSB26-56 : Security update available for Adobe Experience Manager | 06/09/2026 | 06/09/2026 |
 *
 * Each row links to a per-bulletin page (e.g. /security/products/...)
 * that contains the affected product list, CVE IDs, and CVSS scores.
 *
 * The page can be slow (up to 30+ seconds in practice) and may rate-limit
 * per-IP. We fetch the index, extract bulletin IDs + dates, and only
 * follow into detail pages for the most recent N advisories (the table
 * already exposes the dates and product names we need for time-series
 * data; the per-bulletin CVE fetch is best-effort).
 *
 * NVD fallback: the `adobe` CPE vendor in `nvd.ts` fills CVE-level
 * details for anything we miss here.
 */

import { buildRecord, extractCveIds, parseDate } from '../normalise.js';
import { fetchWithRetry } from '../fetch-with-retry.js';
import type { VulnerabilityRecord } from '../types.js';

const ADOBE_INDEX_URL = 'https://helpx.adobe.com/security.html';
// Base URL for resolving relative <a href> targets in the index.
// Adobe's per-bulletin links are typically like
//   /security/products/Experience-Manager/apsb26-56.html
// but we capture whatever they actually serve rather than guess.
const ADOBE_BASE_URL = 'https://helpx.adobe.com';
const MAX_DETAIL_PAGES = 25; // safety cap — most recent N bulletins

const SEVERITY_MAP: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
  Critical: 'critical',
  High: 'high',
  Important: 'high', // Adobe uses "Important" for what CVSS calls High
  Medium: 'medium',
  Moderate: 'medium', // Adobe uses "Moderate" for what CVSS calls Medium
  Low: 'low',
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface AdobeBulletin {
  id: string; // APSBXX-YY
  title: string;
  url: string;
  product?: string;
  publishedDate?: string;
  updatedDate?: string;
  cveIds?: string[];
  severity?: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Fetch the Adobe security index page and extract bulletin rows.
 *
 * Row format (regex targets a self-contained table row):
 *   <td>...APSBXX-YY : <a href=".../products/...">Title</a>...</td>
 *   <td>MM/DD/YYYY</td>
 *   <td>MM/DD/YYYY</td>
 *
 * Adobe's HTML is somewhat noisy, so we anchor on the APSB ID which
 * is always present and unique.
 */
async function fetchIndex(): Promise<string> {
  // Adobe's index page is genuinely slow (30+ sec in practice). Use a
  // 60s timeout (longer than the default 30s) and the standard 3 retries
  // for transient failures.
  const response = await fetchWithRetry(
    ADOBE_INDEX_URL,
    {
      headers: { 'User-Agent': 'VulnTrends/0.1 (https://github.com/vulntrends)' },
      timeoutMs: 60_000,
    },
  );
  if (!response.ok) {
    throw new Error(`Adobe index fetch failed: ${response.status}`);
  }
  return response.text();
}

function parseIndex(html: string): AdobeBulletin[] {
  const bulletins: AdobeBulletin[] = [];
  const seen = new Set<string>();

  // Each row links to a per-product page. The APSB ID appears in the
  // link text in the form "APSBXX-YY : Security update available for ..."
  // Some rows may have a different link target; we capture both.
  const rowRegex =
    /<tr[^>]*>\s*<td[^>]*>[\s\S]*?(APSB\d{2}-\d{2})\s*:?\s*[\s\S]*?<\/td>\s*<td[^>]*>([\d/]+)<\/td>\s*<td[^>]*>([\d/]+)<\/td>[\s\S]*?<\/tr>/gi;

  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(html)) !== null) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);

    const row = match[0];

    // Extract the title from the row's link text. The link text is the
    // longest run of non-tag content between the closing `>` of the
    // <a href="..."> opening tag and the closing </a> tag. We require
    // a `>` immediately before the APSB ID match so the regex doesn't
    // grab the APSB ID that appears in the URL itself (e.g.
    // `apsb26-56.html`); we want the one in the link text.
    const titleMatch = row.match(
      new RegExp('>\\s*' + id + '\\s*:?\\s*[:\\s]*([^<]+?)\\s*</a>', 'i'),
    );
    const title = titleMatch?.[1].trim() || id;

    // Capture the per-bulletin link target if Adobe serves one. The row
    // typically contains `<a href="/security/products/.../apsbXX-YY.html">`
    // which is the actual per-bulletin page; we want this so
    // fetchBulletinDetail() targets the real advisory (not the index)
    // and so rawUrl in the output points somewhere useful. We resolve
    // relative URLs against ADOBE_BASE_URL. If no link is present,
    // fall back to the index anchor — better than the wrong URL but
    // not the same as a real per-bulletin page.
    const linkMatch = row.match(
      /href="((?:\/security\/|https?:\/\/helpx\.adobe\.com)[^"]+)"/i,
    );
    let url: string;
    if (linkMatch) {
      const href = linkMatch[1];
      url = href.startsWith('http') ? href : `${ADOBE_BASE_URL}${href}`;
    } else {
      url = `${ADOBE_INDEX_URL}#${id}`;
    }

    // Product name is the first <td> in the row.
    const productMatch = row.match(/<td[^>]*>([A-Za-z][^<]*?)\s*(?:&nbsp;|\s)*APSB/i);
    const product = productMatch?.[1].trim();

    const publishedDate = parseDate(match[2]);
    const updatedDate = parseDate(match[3]);

    bulletins.push({
      id,
      title,
      url,
      product,
      publishedDate,
      updatedDate,
    });
  }

  return bulletins;
}

/**
 * Best-effort: fetch a per-bulletin page and extract CVE IDs and severity.
 * Adobe's per-product pages (e.g. /security/products/...) list CVEs but
 * their HTML structure varies by product, so we keep this defensive.
 */
async function fetchBulletinDetail(bulletin: AdobeBulletin): Promise<void> {
  try {
    const response = await fetchWithRetry(bulletin.url, {
      headers: { 'User-Agent': 'VulnTrends/0.1 (https://github.com/vulntrends)' },
    });
    if (!response.ok) return;
    const html = await response.text();
    const cves = extractCveIds(html);
    if (cves && cves.length > 0) bulletin.cveIds = cves;
    // Look for a severity badge: "Severity: <level>" or "<level> severity"
    const severityMatch = html.match(
      /Severity[^A-Za-z]+(Critical|Important|High|Medium|Moderate|Low)/i,
    );
    if (severityMatch) {
      bulletin.severity = SEVERITY_MAP[severityMatch[1]] ?? undefined;
    }
  } catch {
    // Best-effort — silent on failure
  }
}

export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Adobe: fetching PSIRT advisories...');
  let html: string;
  try {
    html = await fetchIndex();
  } catch (err) {
    console.warn('  Adobe: index fetch failed, skipping —', err);
    return [];
  }

  const bulletins = parseIndex(html);
  if (bulletins.length === 0) {
    console.warn('  Adobe: index parsed 0 bulletins (page structure may have changed)');
    return [];
  }

  // Best-effort fetch of the most recent MAX_DETAIL_PAGES for CVE IDs.
  // Older bulletins still get time-series data from the index (date + title).
  for (const bulletin of bulletins.slice(0, MAX_DETAIL_PAGES)) {
    await fetchBulletinDetail(bulletin);
    await sleep(300);
  }

  // Build records. Adobe bulletins typically don't have a separate
  // "discovery" date — the publishedDate is when the fix was
  // announced. We use publishedDate as discoveredDate and
  // updatedDate as patchedDate (the latter is often the same day, but
  // a difference of weeks/months is possible for post-release fixes).
  const records: VulnerabilityRecord[] = [];
  for (const b of bulletins) {
    const date = b.publishedDate ?? b.updatedDate;
    if (!date) continue;
    // Pick the first CVE as the record ID; fall back to the APSB ID.
    const id = b.cveIds?.[0] ?? b.id;
    records.push(
      buildRecord({
        id,
        source: 'adobe',
        manufacturer: 'Adobe',
        product: b.product,
        title: b.title,
        severity: b.severity,
        discoveredDate: b.publishedDate ?? date,
        publishedDate: b.publishedDate,
        patchedDate: b.updatedDate,
        cveIds: b.cveIds,
        rawUrl: b.url,
      }),
    );
  }

  console.log(`  Adobe: parsed ${records.length} advisories`);
  return records;
}
