/**
 * Normalisation helpers for converting vendor-specific data into canonical
 * VulnerabilityRecord objects.
 */

import type { Severity, VulnerabilityRecord } from './types.js';

/**
 * Parse a date string into ISO `YYYY-MM-DD` format.
 * Returns `undefined` if the input is null, empty, or unparseable.
 *
 * Two cases:
 *
 * 1. Inputs that include an explicit time or timezone offset (ISO 8601 with
 *    "T...Z" or "T...+HH:MM", etc.) are unambiguous. We use the UTC
 *    calendar components to get a stable date across machines.
 *
 * 2. Timezone-naive date inputs (e.g. "January 7, 2025", "2025-01-07") are
 *    interpreted as local time by `new Date()`. In a positive UTC offset,
 *    the resulting UTC instant may be in the *previous* calendar day, so
 *    `toISOString().slice(0, 10)` would shift the date backwards. Instead,
 *    we extract the year/month/day from the local calendar components
 *    (`getFullYear`, `getMonth`, `getDate`) which reflect the parsed
 *    calendar date regardless of timezone.
 */
export function parseDate(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const d = new Date(input);
  if (isNaN(d.getTime())) return undefined;

  // ISO 8601 with explicit time or timezone → safe to use UTC components
  const hasExplicitTime = /T\d{2}:\d{2}/.test(input);
  const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}\s*$/.test(input);
  if (hasExplicitTime && hasTimezone) {
    return d.toISOString().slice(0, 10);
  }

  // Date-only ISO strings are already unambiguous; return as-is to avoid TZ shifts.
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }
 
  // Timezone-naive date — use local calendar components to preserve
  // the parsed calendar day across machines in positive UTC offsets.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Compute the number of days between two ISO date strings.
 * Returns `undefined` if either date is missing or invalid.
 */
export function computePatchLagDays(
  discovered: string | undefined,
  patched: string | undefined,
): number | undefined {
  if (!discovered || !patched) return undefined;
  const d1 = new Date(discovered);
  const d2 = new Date(patched);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return undefined;
  const diffMs = d2.getTime() - d1.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Map a numeric CVSS score to a severity bucket.
 * Uses the standard CVSS v3.x qualitative severity scale.
 */
export function cvssToSeverity(cvss: number | undefined): Severity | undefined {
  if (cvss == null) return undefined;
  if (cvss >= 9.0) return 'critical';
  if (cvss >= 7.0) return 'high';
  if (cvss >= 4.0) return 'medium';
  return 'low';
}

/**
 * Normalise a manufacturer name to a canonical display name.
 * Handles common variants and abbreviations.
 */
const MANUFACTURER_ALIASES: Record<string, string> = {
  // Mozilla
  mozilla: 'Mozilla',
  'mozilla corporation': 'Mozilla',
  'mozilla foundation': 'Mozilla',
  firefox: 'Mozilla',
  // Google
  google: 'Google',
  'google llc': 'Google',
  'google chrome': 'Google',
  chrome: 'Google',
  alphabet: 'Google',
  // Microsoft
  microsoft: 'Microsoft',
  'microsoft corporation': 'Microsoft',
  msrc: 'Microsoft',
  windows: 'Microsoft',
  // Apple
  apple: 'Apple',
  'apple inc': 'Apple',
  'apple inc.': 'Apple',
  macos: 'Apple',
  ios: 'Apple',
  // Oracle
  oracle: 'Oracle',
  'oracle corporation': 'Oracle',
  // Samsung
  samsung: 'Samsung',
  'samsung electronics': 'Samsung',
  // Project Zero (Google's research team — group under Google)
  'project zero': 'Google',
  'google project zero': 'Google',
  // Palo Alto Networks
  'palo alto': 'Palo Alto',
  'palo alto networks': 'Palo Alto',
  'paloaltonetworks': 'Palo Alto',
  'pan-os': 'Palo Alto',
  'panos': 'Palo Alto',
  // Fortinet
  fortinet: 'Fortinet',
  'fortinet inc': 'Fortinet',
  fortios: 'Fortinet',
  fortiproxy: 'Fortinet',
  // Cisco
  cisco: 'Cisco',
  'cisco systems': 'Cisco',
  // Adobe
  adobe: 'Adobe',
  'adobe inc': 'Adobe',
  'adobe systems': 'Adobe',
};

export function normaliseManufacturer(raw: string): string {
  const key = raw.toLowerCase().trim();
  return MANUFACTURER_ALIASES[key] ?? raw.trim();
}

/**
 * Extract CVE IDs from a free-text string.
 * Matches the standard CVE ID format: CVE-YYYY-NNNNN+.
 */
const CVE_REGEX = /CVE-\d{4}-\d{4,}/gi;

export function extractCveIds(text: string | undefined): string[] | undefined {
  if (!text) return undefined;
  const matches = text.match(CVE_REGEX);
  if (!matches || matches.length === 0) return undefined;
  // Deduplicate, preserving order
  return [...new Set(matches.map((m) => m.toUpperCase()))];
}

/**
 * Build a complete VulnerabilityRecord, filling in computed fields
 * (patchLagDays, severity from CVSS) and normalising manufacturer.
 */
export function buildRecord(
  partial: Omit<VulnerabilityRecord, 'manufacturer'> & {
    manufacturer: string;
  },
): VulnerabilityRecord {
  const manufacturer = normaliseManufacturer(partial.manufacturer);
  const patchLagDays =
    partial.patchLagDays ??
    computePatchLagDays(partial.discoveredDate, partial.patchedDate);
  const severity = partial.severity ?? cvssToSeverity(partial.cvss);

  return {
    ...partial,
    manufacturer,
    patchLagDays,
    severity,
  };
}

/**
 * Merge two records for the same CVE, taking the best fields from each.
 *
 * Vendor advisories (Mozilla, MSRC, Chrome, Apple) typically have a patch
 * date but use it as both discoveredDate and patchedDate (→ 0 lag). NVD
 * records have a `published` date (a proxy for discovery) but no patch
 * date. By merging, we get the NVD discovery date + the vendor patch date,
 * yielding a real patch lag.
 *
 * Preference order for each field:
 * - discoveredDate: earliest among the candidates that match the
 *   CVE-year sanity check (DATE_SANITY_MAX_YEARS). If both candidates
 *   fail, returns null and the caller drops the record rather than
 *   contaminating the dataset with a known-bad date. See the
 *   dedupRecords header comment for the full rationale.
 * - patchedDate: vendor date > NVD (NVD doesn't have patch dates);
 *   OSV's `modified` is a low-confidence patch proxy
 * - severity/cvss: whichever is present (prefer vendor if both)
 * - source: keep the vendor source (richer data overall)
 *
 * Returns `null` when the only available `discoveredDate` candidates
 * both fail the CVE-year sanity check — letting the dedup drop the
 * record entirely rather than shipping a known-bad date into the
 * aggregated data.
 */
function mergeRecords(
  vendor: VulnerabilityRecord,
  nvd: VulnerabilityRecord,
): VulnerabilityRecord | null {
  // Apply the CVE-year sanity check to each candidate before picking.
  // Whichever candidates pass are merged with the "vendor used patch as
  // discovery" legacy tie-breaker. See the dedupRecords header comment
  // for the full rationale.
  const saneVendorDate = dateMatchesCveYear(vendor.discoveredDate, vendor.cveIds ?? [vendor.id]);
  const saneNvdDate = dateMatchesCveYear(nvd.discoveredDate, nvd.cveIds ?? [nvd.id]);

  // Surviving candidates in source-precedence order: vendor first (we
  // already established vendor > NVD in this function), then NVD.
  const candidates: string[] = [];
  if (saneVendorDate) candidates.push(saneVendorDate);
  if (saneNvdDate && saneNvdDate !== saneVendorDate) candidates.push(saneNvdDate);

  // Pick the earliest surviving candidate. The "earliest wins" rule is
  // what catches MSRC catalog re-imports: the spurious 2025-09-04
  // stamp loses to NVD's 2010-12-15 `published` (which survives the
  // sanity check because it matches the CVE-year of CVE-2010-4756).
  //
  // We also accept the legacy single-source fallback (vendor date only,
  // no NVD record) so a vendor-only CVE isn't dropped just because its
  // date fails the strict sanity check — but only for records that
  // come from a vendor source, which legitimately publishes both
  // before-disclosure and post-disclosure and may legitimately have
  // a year offset (e.g. CVE-2016-9535 announced in 2017).
  let discoveredDate: string;
  if (candidates.length > 0) {
    discoveredDate = candidates.reduce((earliest, cur) => (cur < earliest ? cur : earliest));
  } else if (vendor.discoveredDate) {
    // Single-source CVE: only the vendor has a date, and it failed
    // the sanity check. Drop the record rather than ship a
    // known-bad date into the aggregated data — the audit script
    // surfaces what we dropped so an operator can investigate.
    return null;
  } else if (nvd.discoveredDate) {
    // Vendor has no date; use NVD's even if it failed the sanity
    // check (better than nothing).
    discoveredDate = nvd.discoveredDate;
  } else {
    // Neither source has a date. Drop rather than emit an empty
    // string (which would corrupt time-series aggregations).
    return null;
  }

  // Legacy tie-breaker: if the chosen discovery date equals the
  // vendor's patched date, that's a signal the vendor used the patch
  // date as a discovery proxy. Promote the NVD date in that case
  // (only if it survived the sanity check and differs).
  if (
    discoveredDate === vendor.patchedDate &&
    saneNvdDate &&
    saneNvdDate !== vendor.patchedDate
  ) {
    discoveredDate = saneNvdDate;
  }

  const patchedDate = vendor.patchedDate ?? nvd.patchedDate;
  const patchLagDays = computePatchLagDays(discoveredDate, patchedDate);

  return {
    ...vendor,
    discoveredDate,
    patchedDate,
    patchLagDays,
    // Prefer vendor severity/cvss, fall back to NVD
    severity: vendor.severity ?? nvd.severity,
    cvss: vendor.cvss ?? nvd.cvss,
  };
}

/**
 * Maximum allowed offset (in years) between a record's `discoveredDate`
 * and the CVE ID's CVE-year before the date is treated as an upstream
 * pipeline artefact and discarded during dedup. MSRC's catalog
 * re-imports currently use a 2025-09-03 stamp for CVEs going back to
 * 1999, so a tolerance of 1 year is comfortably tight for legitimate
 * data and aggressively rejects the artefact. Bump this only if a real
 * source starts producing legitimately-late disclosures (e.g. CVE
 * assignment for a long-running embargo).
 */
export const DATE_SANITY_MAX_YEARS = 1;

/**
 * Test whether a record's `discoveredDate` is plausibly close to the
 * CVE's CVE-year. Returns the unchanged date if it is, or `undefined`
 * if it isn't.
 *
 * Exported so the audit script can flag records where *both* candidates
 * fail the sanity check (those are the ones that survive into the
 * final dataset as known-bad dates and need human attention).
 */
export function dateMatchesCveYear(
  date: string | undefined,
  cveIds: string[],
): string | undefined {
  if (!date) return undefined;
  if (cveIds.length === 0) return date;

  const dateYear = Number.parseInt(date.slice(0, 4), 10);
  if (!Number.isFinite(dateYear)) return date;

  for (const cveId of cveIds) {
    const m = cveId.match(/^CVE-(\d{4})-\d+$/i);
    if (!m) continue;
    const cveYear = Number.parseInt(m[1], 10);
    if (!Number.isFinite(cveYear)) continue;
    const diff = Math.abs(dateYear - cveYear);
    if (diff <= DATE_SANITY_MAX_YEARS) return date;
  }

  // No CVE in the list had a year within tolerance. Reject the date.
  return undefined;
}

/**
 * Source precedence order for dedup. A "lower" value means the source
 * is more authoritative and is preferred when merging.
 *
 *   1 = vendor advisory (Mozilla, MSRC, Chrome, Apple, …)
 *   2 = osv              (richer timing than NVD; cross-vendor curated)
 *   3 = nvd              (fallback cross-vendor coverage)
 */
const SOURCE_PRECEDENCE: Record<string, number> = {
  mozilla: 1,
  msrc: 1,
  apple: 1,
  chrome: 1,
  pan: 1,
  fortinet: 1,
  adobe: 1,
  projectzero: 1,
  cisco: 1, // stub-only; same precedence as other vendors
  osv: 2,
  nvd: 3,
};

function precedenceOf(source: string): number {
  return SOURCE_PRECEDENCE[source] ?? 3;
}

/**
 * Deduplicate an array of records by their `id` field.
 *
 * When multiple sources report the same CVE we keep the most authoritative
 * (per `SOURCE_PRECEDENCE`) and fold in better-timed fields from the others.
 *
 * ## Date selection
 *
 * The merge picks the most plausible `discoveredDate` from the union of
 * the primary's and secondary's candidates. Two guards apply, in order:
 *
 *  1. **CVE-year sanity check.** If one candidate's year differs from
 *     the CVE ID's CVE-year by more than {@link DATE_SANITY_MAX_YEARS}
 *     (default 1 year), it's an upstream-pipeline artefact
 *     (e.g. MSRC catalog re-imports stamp 1999 CVEs with 2025 dates).
 *     Discard the bad candidate before picking the earlier remaining
 *     one.
 *
 *  2. **"Vendor used patch as discovery" legacy check.** Keep this as a
 *     secondary tie-breaker: if the surviving primary candidate equals
 *     the primary's `patchedDate` (Mozilla's behaviour), promote the
 *     secondary's date if present.
 *
 * Both candidates passing both checks is rare; in that case we keep the
 * primary's date.
 */
export function deduplicateRecords(
  records: VulnerabilityRecord[],
): VulnerabilityRecord[] {
  const byId = new Map<string, VulnerabilityRecord>();

  for (const record of records) {
    const existing = byId.get(record.id);
    if (!existing) {
      byId.set(record.id, record);
      continue;
    }

    const existingP = precedenceOf(existing.source);
    const recordP = precedenceOf(record.source);

    // Same precedence → keep the first
    if (existingP === recordP) continue;

    // The "primary" is the more authoritative source; the "secondary"
    // contributes timing data only. Routing both call sites through
    // the shared `mergeRecords` keeps the date-selection logic in one
    // place so the CVE-year sanity check applies everywhere. If the
    // merge returns null (both candidates failed the sanity check),
    // we drop the record rather than ship a known-bad date.
    const merged =
      existingP < recordP
        ? mergeRecords(existing, record)
        : mergeRecords(record, existing);
    if (merged === null) {
      byId.delete(record.id);
      continue;
    }
    byId.set(record.id, merged);
  }

  return [...byId.values()].filter((r): r is VulnerabilityRecord => r !== null);
}

/**
 * Deduplicate records by CVE ID rather than record ID.
 *
 * Materialises one output record per CVE key, setting `id` and `cveIds` to
 * that single CVE so every returned record has a unique ID. This prevents
 * advisories that cover multiple CVEs from appearing multiple times in the
 * output and inflating downstream counts.
 *
 * When multiple sources report the same CVE we keep the most authoritative
 * (per `SOURCE_PRECEDENCE`) and fold in better-timed fields from the others.
 *
 * Records with no CVE IDs are deduplicated by their own `id` field and
 * included as-is.
 */
export function deduplicateByCve(
  records: VulnerabilityRecord[],
): VulnerabilityRecord[] {
  const byCve = new Map<string, VulnerabilityRecord>();

  for (const record of records) {
    const cves = record.cveIds ?? [];
    if (cves.length === 0) continue;

    for (const cve of cves) {
      const existing = byCve.get(cve);
      if (!existing) {
        byCve.set(cve, { ...record, id: cve, cveIds: [cve] });
        continue;
      }

      const existingP = precedenceOf(existing.source);
      const recordP = precedenceOf(record.source);
      if (existingP === recordP) continue;

      // Same source precedence means we just keep the first-encountered
      // record (no merge needed) and continue. The merge only happens
      // across precedence levels, exactly like deduplicateRecords.
      if (existingP < recordP) {
        // existing is primary; record is secondary
        const merged = mergeRecords(existing, record);
        if (merged === null) continue; // both candidates failed sanity — drop
        byCve.set(cve, { ...merged, id: cve, cveIds: [cve] });
      } else {
        // record is primary; existing is secondary
        const merged = mergeRecords(record, existing);
        if (merged === null) continue; // both candidates failed sanity — drop
        byCve.set(cve, { ...merged, id: cve, cveIds: [cve] });
      }
    }
  }

  // Also include records with no CVE IDs — deduplicate by their own id
  const byId = new Map<string, VulnerabilityRecord>();
  for (const record of records) {
    if (!record.cveIds || record.cveIds.length === 0) {
      if (!byId.has(record.id)) {
        byId.set(record.id, record);
      }
    }
  }

  return [...byCve.values(), ...byId.values()];
}
