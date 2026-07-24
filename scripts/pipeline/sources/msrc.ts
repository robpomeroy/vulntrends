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
 *
 * ## Mariner handling
 *
 * MSRC publishes a separate CVRF document per Mariner (their Linux
 * distribution) advisory. Each Mariner document references ~30 upstream
 * Linux CVE IDs (e.g. CVE-2010-0291, the Linux kernel `do_mremap()`
 * vulnerability), and each `<vuln:Vulnerability>` in the document is
 * tagged with `<vuln:Note Title="Mariner" Type="Tag">Mariner</vuln:Note>`.
 *
 * If we naively imported these as Microsoft records, two problems appear:
 *  1. The "Discovered" chart gets a misleading spike every time MSRC
 *     re-imports the Mariner catalog (currently 64 documents × ~30
 *     CVEs each, refreshed a few times a year).
 *  2. Those upstream CVEs are already in NVD's Linux CPE coverage, so
 *     including them as Microsoft double-counts them.
 *
 * We therefore skip both Mariner-titled documents and any individual
 * vulnerability tagged with the Mariner note. The upstream CVEs remain
 * in the dataset via NVD.
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
 * Mariner documents have a `DocumentTitle` of "Mariner Release Notes"
 * in the MSRC update list. We skip these at the document level so we
 * don't even fetch the body — saving bandwidth and avoiding the
 * "MSRC re-imported the Mariner catalog" spike on the Discovered chart.
 */
function isMarinerDocument(update: CvrfUpdate): boolean {
  return /mariner/i.test(update.DocumentTitle);
}

/**
 * Per-vulnerability Mariner check. Some Mariner-tagged CVEs also
 * appear in regular Security Update documents; the per-vuln Mariner
 * note lets us drop them at the record level.
 *
 * Matches `<vuln:Note Title="Mariner" ...>Mariner</vuln:Note>`.
 */
const MARINER_NOTE_REGEX = /<vuln:Note\b[^>]*\bTitle="Mariner"[^>]*>/;

function isMarinerVulnerability(block: string): boolean {
  return MARINER_NOTE_REGEX.test(block);
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

    // Skip Mariner-tagged vulnerabilities. They're upstream Linux CVEs
    // that NVD already covers; including them as Microsoft records
    // would double-count and produce misleading spikes whenever MSRC
    // re-imports the Mariner catalog. See the file-level Mariner
    // handling comment for the full rationale.
    if (isMarinerVulnerability(block)) continue;

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

    // Per-vulnerability publication date.
    //
    // MSRC's `CurrentReleaseDate` (the update-level timestamp) is "when this
    // CVRF document was last refreshed", NOT "when this CVE was disclosed".
    // Bulk catalog re-publications (e.g. 2026-Jul, 2026-Feb) stamp every
    // CVE with the re-publication date — including CVEs from 1999 — which
    // produces a misleading 25k+ spike on the "Discovered" chart.
    //
    // The authoritative per-CVE date lives in `<vuln:RevisionHistory>` as a
    // series of `<cvrf:Date>` entries (one per revision). The earliest of
    // these is the CVE's initial publication date. Fall back to
    // `CurrentReleaseDate` only when no RevisionHistory is present.
    const revBlock = block.match(
      /<vuln:RevisionHistory>([\s\S]*?)<\/vuln:RevisionHistory>/,
    );
    let perVulnDate: string | undefined;
    if (revBlock) {
      const revDates = [
        ...revBlock[1].matchAll(/<cvrf:Date>([^<]+)<\/cvrf:Date>/g),
      ]
        .map((m) => m[1])
        .sort();
      if (revDates.length > 0) perVulnDate = parseDate(revDates[0]);
    }
    const effectiveDate = perVulnDate ?? patchedDate;
    if (!effectiveDate) continue;

    records.push(
      buildRecord({
        id: cveId,
        source: 'msrc',
        manufacturer: 'Microsoft',
        title,
        cvss,
        // Use the per-CVE initial publication date as `discoveredDate`
        // (this is when the CVE was first made public). The update-level
        // `patchedDate` stays as the document's last refresh, which for
        // normal monthly updates is a reasonable proxy for the patch
        // release date.
        discoveredDate: effectiveDate,
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
    .replace(/&apos;/g, "'")
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
  const skippedMariner: string[] = [];
  const batchSize = 3;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    // Filter out Mariner documents at the orchestrator level so we
    // never even fetch the body. Logging the skip here keeps the
    // pipeline run auditable — an operator can see how many Mariner
    // docs were excluded in the run log.
    const filteredBatch = batch.filter((u) => {
      if (isMarinerDocument(u)) {
        skippedMariner.push(u.ID);
        return false;
      }
      return true;
    });
    if (filteredBatch.length === 0) continue;
    const batchRecords = await Promise.all(filteredBatch.map(fetchCvrfRecords));
    allRecords.push(...batchRecords.flat());
    if (i + batchSize < updates.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  if (skippedMariner.length > 0) {
    console.log(`Microsoft MSRC: skipped ${skippedMariner.length} Mariner document(s) (${skippedMariner.slice(0, 5).join(', ')}${skippedMariner.length > 5 ? '…' : ''})`);
  }

  console.log(`Microsoft MSRC: ${allRecords.length} records extracted`);
  return allRecords;
}
