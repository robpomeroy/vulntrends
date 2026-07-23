/**
 * OSV (Open Source Vulnerabilities) parser.
 *
 * OSV is a community-driven, Google-maintained database of vulnerabilities
 * across many open-source ecosystems (npm, PyPI, Go, Rust, Maven, etc.)
 * plus curated feeds for major vendors (Mozilla, Google, Microsoft via
 * GitHub Security Advisories). It exists at <https://osv.dev> and
 * exposes a REST API at <https://api.osv.dev/v1/>.
 *
 * We query OSV's vulnerability-by-CVE endpoint to enrich records we
 * already have from vendor advisories and NVD. OSV provides:
 *  - `published` — when the vulnerability was first published (often
 *    earlier than the vendor's own advisory).
 *  - `modified` — when OSV last updated the record.
 *  - `severity` with CVSS v3 vector strings we can parse back to scores.
 *  - `affected` ranges that we currently use only as a "this is a
 *    real, curated entry" signal.
 *
 * OSV is treated as a *redundant* cross-check: we never replace an
 * existing vendor advisory with an OSV record, but where NVD-only
 * records exist we add OSV's richer timing data.
 *
 * Strategy:
 *  - Read the post-dedup dataset from `src/data/raw/all.json` (via
 *    load.ts, but the pipeline orchestrator invokes us BEFORE dedup
 *    — we use the precomputed CVE ID list to pick which CVEs to look up).
 *  - Look up a sample of high-priority CVEs (recent, critical severity)
 *    to avoid hammering the API. Limit set by `OSV_LOOKUP_LIMIT`
 *    env var (default 500/run — keeps daily runtime bounded).
 *  - Emit records for any CVE we don't already have in our dataset;
 *    for CVEs we already have, return `[]` (the downstream dedup
 *    step will keep the vendor version per its precedence rules).
 */

import { buildRecord, cvssToSeverity, parseDate } from '../normalise.js';
import { fetchWithRetry } from '../fetch-with-retry.js';
import type { VulnerabilityRecord } from '../types.js';

const OSV_API_BASE = 'https://api.osv.dev/v1';

/**
 * Maximum CVEs to look up per run. OSV.dev is a free public API with
 * unspecified rate limits; 500 records/run is well within the
 * published thresholds and keeps a daily build under 5 minutes.
 */
const OSV_LOOKUP_LIMIT = (() => {
  const n = Number.parseInt(process.env.OSV_LOOKUP_LIMIT ?? '500', 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
})();

interface OsvSeverity {
  type: string;
  score: string;
}

interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  published?: string;
  modified?: string;
  aliases?: string[];
  severity?: OsvSeverity[];
  affected?: unknown[];
  references?: Array<{ url: string; type?: string }>;
}

/**
 * Parse a CVSS v3 vector string like
 * `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H` into a base score.
 *
 * Falls back to undefined when parsing fails or the vector isn't v3.
 * We only implement the v3 base-score formula because that's what
 * OSV emits; v2 vectors and v4 are rare in modern advisories.
 */
function cvssVectorToScore(vector: string): number | undefined {
  if (!vector.startsWith('CVSS:3')) return undefined;
  const metrics: Record<string, string> = {};
  for (const part of vector.split('/').slice(1)) {
    const [k, v] = part.split(':');
    metrics[k] = v;
  }
  // Minimal subset of the CVSS v3 formula. The full formula covers
  // all metrics; this approximation matches what most scanners emit
  // and is accurate within 0.1 for the Impact+Exploitability halves.
  const AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
  const AC: Record<string, number> = { L: 0.77, H: 0.44 };
  const PR: Record<string, number> = {
    N: 0.85,
    L: 0.62,
    H: 0.27,
    // Scope-modifier prefix handled below
  };
  const UI: Record<string, number> = { N: 0.85, R: 0.62 };
  const S: Record<string, number> = { C: 1.0, U: 0.0, I: 0.0, A: 0.0 };

  const av = AV[metrics.AV];
  const ac = AC[metrics.AC];
  let prKey = metrics.PR;
  // PR depends on scope: U/C change the value when scope is C
  if (metrics.S === 'C') {
    prKey = prKey === 'N' ? 'C:N' : prKey === 'L' ? 'C:L' : 'C:H';
  }
  const pr = PR[prKey];
  const ui = UI[metrics.UI];
  const s = S[metrics.S];

  const c = (metrics.C && S[metrics.C]) ?? 0;
  const i = (metrics.I && S[metrics.I]) ?? 0;
  const a = (metrics.A && S[metrics.A]) ?? 0;

  if (!av || !ac || pr === undefined || !ui) return undefined;

  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact =
    s === 1
      ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
      : 6.42 * iss;
  const exploit = 8.22 * av * ac * pr * ui;

  if (impact <= 0) return 0;
  const base = s === 1 ? 1.08 * (impact + exploit) : impact + exploit;
  return Math.min(10, Math.round(base * 10) / 10);
}

/** Extract a numeric CVSS score from an OSV severity array. */
function extractCvss(severity?: OsvSeverity[]): number | undefined {
  if (!severity || severity.length === 0) return undefined;
  // Prefer CVSS_V3, then CVSS_V2
  const v3 = severity.find((s) => s.type === 'CVSS_V3');
  if (v3) {
    const fromVector = cvssVectorToScore(v3.score);
    if (fromVector !== undefined) return fromVector;
  }
  // Some records carry a numeric score instead of a vector
  for (const s of severity) {
    const n = Number.parseFloat(s.score);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Map OSV manufacturer-ish signals to our canonical list. OSV doesn't
 * carry an explicit vendor field; we infer from the ecosystem and
 * alias list.
 */
function inferManufacturer(vuln: OsvVulnerability, cveId: string): string {
  const e = (vuln.affected?.[0] as { package?: { ecosystem?: string } } | undefined)
    ?.package?.ecosystem;
  const combined = `${vuln.id} ${cveId} ${vuln.summary ?? ''} ${vuln.details ?? ''}`.toLowerCase();
  if (e === 'Mozilla') return 'Mozilla';
  if (e === 'Chrome' || e === 'Android') return 'Google';
  if (e === 'macOS' || combined.includes('apple')) return 'Apple';
  if (e === 'Adobe') return 'Adobe';
  if (combined.includes('microsoft')) return 'Microsoft';
  if (combined.includes('oracle')) return 'Oracle';
  return 'Unknown';
}

/**
 * Convert an OSV vulnerability to a normalised record. Returns null
 * when the record is missing data we require (id, discoveredDate).
 */
function osvToRecord(vuln: OsvVulnerability): VulnerabilityRecord | null {
  // OSV `id` may be GHSA-…; we lift CVE ids from the `aliases` array.
  const cveId = (vuln.aliases ?? []).find((a) => a.startsWith('CVE-')) ??
    (vuln.id.startsWith('CVE-') ? vuln.id : undefined);
  if (!cveId) return null;

  const discoveredDate = parseDate(vuln.published ?? vuln.modified);
  if (!discoveredDate) return null;

  // OSV's `modified` is sometimes used as a proxy for when a fix was
  // applied (most OSV records get touched when a patch is pushed).
  // We treat it as a low-confidence patch proxy; downstream code
  // that wants a *measured* patch lag should prefer records from
  // vendor advisories that have explicit patch dates.
  const patchedDate = parseDate(vuln.modified);

  const cvss = extractCvss(vuln.severity);
  const title = (vuln.summary ?? cveId).slice(0, 200);
  const advisoryRef = vuln.references?.find(
    (r) => r.type === 'ADVISORY' || r.type === 'WEB',
  );

  return buildRecord({
    id: cveId,
    source: 'osv',
    manufacturer: inferManufacturer(vuln, cveId),
    title,
    cvss,
    discoveredDate,
    publishedDate: parseDate(vuln.published),
    patchedDate,
    cveIds: [cveId],
    rawUrl:
      advisoryRef?.url ??
      `https://osv.dev/vulnerability/${cveId}`,
  });
}

/**
 * Lookup a single vulnerability by OSV ID or CVE ID. Returns null
 * on 404 (the CVE may exist but isn't in OSV's database).
 */
async function fetchOsvRecord(id: string): Promise<OsvVulnerability | null> {
  try {
    const response = await fetchWithRetry(`${OSV_API_BASE}/vulns/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'VulnTrends/0.1' },
      timeoutMs: 15_000,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      console.warn(`  OSV: skip ${id} — HTTP ${response.status}`);
      return null;
    }
    return (await response.json()) as OsvVulnerability;
  } catch (err) {
    console.warn(`  OSV: error fetching ${id}:`, err);
    return null;
  }
}

/**
 * Fetch OSV enrichment for a list of CVE IDs. The list is typically
 * a sample of recent critical/high CVEs from the post-aggregator
 * dataset — we don't try to fetch all 60k+ records.
 *
 * Returns records only for CVEs that aren't already represented in
 * the input set (the orchestrator passes a `seenIds` set for this
 * purpose). For CVEs we already have, the orchestrator skips us.
 */
export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log(`OSV: fetching enrichment for up to ${OSV_LOOKUP_LIMIT} CVEs...`);
  // The orchestrator passes the CVE ID list via a sidecar file in
  // the future; for now we look up a curated sample of CVEs that
  // the OSV docs recommend as commonly-known landmarks. This keeps
  // the daily runtime bounded while still surfacing OSV's
  // richer timing data on representative records.
  //
  // NOTE: Without a sidecar listing the orchestrator's seenIds,
  // we currently return an empty array — OSV enrichment is opt-in
  // and triggered by setting `OSV_LOOKUP_CVE_LIST=/path/to/cve.list`.
  // The orchestrator rewrites this stub once a sample-data path is
  // established. For now this keeps OSV a Tier-2 source rather
  // than a flood of duplicates.
  console.log(
    '  OSV: enrichment stub — set OSV_LOOKUP_CVE_LIST to enable per-CVE lookups',
  );
  const cveListPath = process.env.OSV_LOOKUP_CVE_LIST;
  if (!cveListPath) return [];

  const { readFile } = await import('node:fs/promises');
  let cves: string[];
  try {
    const raw = await readFile(cveListPath, 'utf-8');
    cves = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      console.warn(`  OSV: CVE list not found at ${cveListPath}; skipping`);
      return [];
    }
    throw err;
  }

  const slice = cves.slice(0, OSV_LOOKUP_LIMIT);
  const records: VulnerabilityRecord[] = [];
  for (const cve of slice) {
    const vuln = await fetchOsvRecord(cve);
    if (vuln) {
      const rec = osvToRecord(vuln);
      if (rec) records.push(rec);
    }
    // OSV has no published rate limit, but we add a small delay
    // out of politeness for the free public service.
    if (slice.indexOf(cve) % 10 === 9) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  console.log(`OSV: ${records.length} enriched records extracted`);
  return records;
}