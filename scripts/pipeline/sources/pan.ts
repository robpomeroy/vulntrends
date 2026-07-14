/**
 * Palo Alto Networks security advisories parser.
 *
 * PAN publishes advisories at https://security.paloaltonetworks.com/. The
 * site exposes a JSON API:
 *
 *   GET /json?sort=-date&resultsPerPage=N&startIndex=M
 *     → condensed list of advisories (the same data shown in the HTML
 *       table). Each entry has CVE ID, title, CVSS, severity, affected
 *       and fixed version lists, and the publication date.
 *
 *   GET /json/<CVE-ID>     → full advisory (problem description, etc.)
 *   GET /json/PAN-SA-XXX   → full advisory by PAN advisory ID
 *
 * The API is in beta but has been stable in practice. No authentication
 * is required; the same 551 advisories are returned in both HTML and
 * JSON views.
 *
 * The "date" field on each entry is the publication date. PAN does not
 * separately track discovery vs patch dates, so we use the publication
 * date as both `discoveredDate` and `patchedDate`. This means the
 * "patch lag" for Palo Alto will always be 0 days — the chart is
 * meaningful for other manufacturers where we have separate dates,
 * and the Palo Alto line on the patch-lag chart will sit on the
 * x-axis (0 days) for that reason. The discovered/fixed charts
 * still show the publication time-series.
 */

import { buildRecord } from '../normalise.js';
import type { VulnerabilityRecord } from '../types.js';

const PAN_JSON_URL = 'https://security.paloaltonetworks.com/json';
const PAGE_SIZE = 200;

interface PanAdvisory {
  ID?: string;
  PANId?: string;
  title: string;
  threatSeverity?: string;
  baseSeverity?: string;
  baseScore?: number;
  threatScore?: number;
  date: string;
  updated?: string;
  product?: string[];
  version?: string[];
  affected?: string[];
  fixed?: string[];
  problem?: Array<{ lang: string; value: string }>;
}

const SEVERITY_MAP: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NONE: 'low',
  '': 'low',
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Fetch one page of condensed PAN advisories. */
async function fetchPage(startIndex: number): Promise<PanAdvisory[]> {
  const url = `${PAN_JSON_URL}?sort=-date&resultsPerPage=${PAGE_SIZE}&startIndex=${startIndex}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'VulnTrends/0.1 (https://github.com/vulntrends)' },
  });
  if (!response.ok) {
    throw new Error(`Palo Alto JSON fetch failed at startIndex=${startIndex}: ${response.status}`);
  }
  const data = (await response.json()) as PanAdvisory[];
  return Array.isArray(data) ? data : [];
}

/** Convert one PAN advisory into a normalised VulnerabilityRecord. */
function advisoryToRecord(advisory: PanAdvisory): VulnerabilityRecord | null {
  // Use the CVE ID if present, otherwise fall back to the PAN advisory ID.
  const id = advisory.ID ?? advisory.PANId;
  if (!id) return null;

  const date = advisory.date?.slice(0, 10); // ISO 8601 → YYYY-MM-DD
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  // The condensed list doesn't include the full problem description, but
  // it does carry the title. The full description is only on the detail
  // page; we don't fetch detail pages to keep the parser fast.
  const title = advisory.title?.trim() || id;

  const severity =
    SEVERITY_MAP[advisory.baseSeverity?.toUpperCase() ?? ''] ??
    SEVERITY_MAP[advisory.threatSeverity?.toUpperCase() ?? ''];

  // Product: PAN advisories list multiple products. Join the first two
  // for a compact label, fall back to undefined.
  const product = advisory.product?.filter((p) => p && p !== 'None').slice(0, 2).join(', ');

  return buildRecord({
    id,
    source: 'pan',
    manufacturer: 'Palo Alto',
    product: product || undefined,
    title,
    severity,
    cvss: advisory.baseScore,
    discoveredDate: date,
    // PAN doesn't separate discovery from publication; use the same
    // date for both so patch-lag is 0 for PAN records.
    publishedDate: date,
    patchedDate: date,
    cveIds: advisory.ID ? [advisory.ID] : undefined,
    rawUrl: `https://security.paloaltonetworks.com/${encodeURIComponent(id)}`,
  });
}

export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Palo Alto: fetching advisories...');
  const records: VulnerabilityRecord[] = [];
  const seen = new Set<string>();
  let startIndex = 0;
  const seenTotals = new Set<number>();

  // Paginate until we get an empty page (the API has no totalResults
  // field — it just returns whatever fits in the page). Empty array
  // means we've reached the end.
  for (let page = 0; page < 50; page++) {
    const pageRecords = await fetchPage(startIndex);
    if (pageRecords.length === 0) break;
    for (const adv of pageRecords) {
      const rec = advisoryToRecord(adv);
      if (!rec) continue;
      if (seen.has(rec.id)) continue;
      seen.add(rec.id);
      records.push(rec);
    }
    if (pageRecords.length < PAGE_SIZE) break; // last page
    startIndex += PAGE_SIZE;
    await sleep(500); // be polite
    if (seenTotals.has(startIndex)) break; // safety net for looping
    seenTotals.add(startIndex);
  }

  console.log(`  PAN: parsed ${records.length} advisories`);
  return records;
}
