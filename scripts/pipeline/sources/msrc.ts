/**
 * Microsoft Security Response Center (MSRC) parser.
 *
 * MSRC provides a CVRF (Common Vulnerability Reporting Framework) API at:
 *   https://api.msrc.microsoft.com/cvrf/v3.0/
 *
 * The updates list endpoint returns JSON (OData-wrapped). Each per-update
 * CVRF document, however, is served as XML — the server ignores the
 * `Accept: application/json` header on that path. So this parser does a
 * content-type sniff and parses the body accordingly.
 */

import { buildRecord, parseDate } from '../normalise.js';
import { fetchWithRetry } from '../fetch-with-retry.js';
import type { VulnerabilityRecord } from '../types.js';

const MSRC_API_BASE = 'https://api.msrc.microsoft.com/cvrf/v3.0';
const MSRC_API_KEY = process.env.MSRC_API_KEY;

interface CvrfUpdate {
  ID: string;
  Alias: string;
  DocumentTitle: string;
  CurrentReleaseDate: string;
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

  const response = await fetchWithRetry(`${MSRC_API_BASE}/updates`, { headers });
  if (!response.ok) {
    throw new Error(`MSRC update list fetch failed: ${response.status}`);
  }
  const data = await response.json();
  return data.value ?? [];
}

/**
 * Fetch a single CVRF document and extract vulnerability records.
 *
 * The endpoint serves the document as XML regardless of the Accept
 * header, so we read it as text and parse with regex over the CVRF
 * schema (stable, Microsoft-only, well-formed). The CVRF schema uses
 * two namespace prefixes: `cvrf:` for document-level elements and
 * `vuln:` for vulnerability-level elements.
 */
async function fetchCvrfRecords(update: CvrfUpdate): Promise<VulnerabilityRecord[]> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/xml',
      'User-Agent': 'VulnTrends/0.1',
    };
    if (MSRC_API_KEY) {
      headers['Api-Key'] = MSRC_API_KEY;
    }

    const response = await fetchWithRetry(`${MSRC_API_BASE}/cvrf/${update.ID}`, { headers });
    if (!response.ok) {
      console.warn(`  MSRC: skip ${update.ID} — HTTP ${response.status}`);
      return [];
    }

    const patchedDate = parseDate(update.CurrentReleaseDate);
    // MSRC records use the patch date as the discovery-date proxy. If it
    // can't be parsed, skip this update rather than injecting "today"
    // (which would skew aggregates and produce future-dated points).
    if (!patchedDate) {
      console.warn(`  MSRC: skip ${update.ID} — unparseable CurrentReleaseDate`);
      return [];
    }

    const body = await response.text();

    // Sniff: defensive — if the server ever does return JSON on this
    // path, fall back to the old code path rather than blowing up.
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('json') || body.trimStart().startsWith('{')) {
      return parseCvrfAsJson(body, update, patchedDate);
    }
    return parseCvrfAsXml(body, update, patchedDate);
  } catch (err) {
    console.warn(`  MSRC: error fetching ${update.ID}:`, err);
    return [];
  }
}

/**
 * Legacy JSON path. Kept as a fallback in case MSRC ever returns JSON
 * on this endpoint again (or for tests that stub a JSON response).
 */
function parseCvrfAsJson(
  body: string,
  _update: CvrfUpdate,
  patchedDate: string,
): VulnerabilityRecord[] {
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  const vulns = data?.cvrfDocument?.VulnerabilityList ?? data?.vulnList ?? [];
  const records: VulnerabilityRecord[] = [];
  for (const vuln of vulns) {
    const cveId = vuln.CVE ?? vuln.title?.match(/CVE-\d{4}-\d{4,}/i)?.[0];
    if (!cveId) continue;
    const title = vuln.Title ?? cveId;
    const cvss = vuln.CVSSScoreSet?.BaseScore
      ? parseFloat(vuln.CVSSScoreSet.BaseScore)
      : undefined;
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
}

/**
 * XML parser for CVRF documents. Walks the well-formed XML via regex
 * over the stable CVRF 1.1 schema. We avoid a full XML parser
 * dependency because the schema is small, namespace-stable, and only
 * one source uses it.
 */
function parseCvrfAsXml(
  body: string,
  _update: CvrfUpdate,
  patchedDate: string,
): VulnerabilityRecord[] {
  const records: VulnerabilityRecord[] = [];

  // Match each <vuln:Vulnerability ...>...</vuln:Vulnerability> block.
  // Attributes (e.g. Ordinal="523") and nested whitespace are tolerated.
  const vulnBlockRegex = /<vuln:Vulnerability\b[^>]*>([\s\S]*?)<\/vuln:Vulnerability>/g;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = vulnBlockRegex.exec(body)) !== null) {
    const block = blockMatch[1];

    // CVE id (mandatory — skip blocks without one).
    const cveMatch = block.match(/<vuln:CVE>\s*(CVE-\d{4}-\d{4,})\s*<\/vuln:CVE>/);
    if (!cveMatch) continue;
    const cveId = cveMatch[1];

    // Title — fall back to a description excerpt if missing, then to
    // the CVE id so the Zod schema contract (non-empty title) holds.
    const titleMatch = block.match(/<vuln:Title>\s*([^<]+?)\s*<\/vuln:Title>/);
    let title = titleMatch?.[1];
    if (!title) {
      const descMatch = block.match(
        /<vuln:Note[^>]*\bTitle="Description"[^>]*>([\s\S]*?)<\/vuln:Note>/,
      );
      if (descMatch) {
        // Description text is HTML-encoded inside the XML. Strip tags
        // and decode the common entities to get a readable title.
        title = stripHtml(descMatch[1])
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200);
      }
    }
    if (!title) title = cveId;

    // CVSS base score — first vuln:BaseScore inside a vuln:CVSSScoreSet.
    // The CVSS 3.x block sits inside <vuln:CVSSScoreSets>, but a 2.x
    // fallback can also be present; we just take the first numeric
    // base score we find.
    let cvss: number | undefined;
    const baseScoreMatch = block.match(
      /<vuln:CVSSScoreSet\b[^>]*>[\s\S]*?<vuln:BaseScore>\s*([\d.]+)\s*<\/vuln:BaseScore>/,
    );
    if (baseScoreMatch) {
      const parsed = parseFloat(baseScoreMatch[1]);
      if (Number.isFinite(parsed)) cvss = parsed;
    }

    // MSRC doesn't provide discovery dates — use the patch date as a proxy.
    records.push(
      buildRecord({
        id: cveId,
        source: 'msrc',
        manufacturer: 'Microsoft',
        title,
        cvss,
        discoveredDate: patchedDate,
        patchedDate,
        cveIds: [cveId],
        rawUrl: `https://msrc.microsoft.com/update-guide/vulnerability/${cveId}`,
      }),
    );
  }

  return records;
}

/**
 * Strip HTML tags and decode the few entities MSRC embeds in CVRF
 * description text. Not a general-purpose unescape — just enough to
 * produce a readable title.
 */
function stripHtml(s: string): string {
  const decoded = s
    // Decode &amp; first so sequences like "&amp;lt;" become "&lt;" and get decoded further.
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#39;/g, "'");

  return decoded.replace(/<[^>]+>/g, '');
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
