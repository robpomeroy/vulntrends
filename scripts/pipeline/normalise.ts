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
  // Linux
  linux: 'Linux',
  'linux kernel': 'Linux',
  'linux foundation': 'Linux',
  kernel: 'Linux',
  // Project Zero (Google's research team — group under Google)
  'project zero': 'Google',
  'google project zero': 'Google',
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
 * Deduplicate an array of records by their `id` field.
 * When two records share an ID, the one from a vendor-specific source
 * (non-NVD) is preferred, as it typically has richer timing data.
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
    // Prefer non-NVD records (vendor advisories have better timing data)
    if (existing.source === 'nvd' && record.source !== 'nvd') {
      byId.set(record.id, record);
    }
  }

  return [...byId.values()];
}

/**
 * Deduplicate records by CVE ID rather than record ID.
 *
 * Materialises one output record per CVE key, setting `id` and `cveIds` to
 * that single CVE so every returned record has a unique ID. This prevents
 * advisories that cover multiple CVEs from appearing multiple times in the
 * output and inflating downstream counts.
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
        // Materialise a new record scoped to this single CVE
        byCve.set(cve, { ...record, id: cve, cveIds: [cve] });
        continue;
      }
      // Prefer non-NVD records (vendor advisories have better timing data)
      if (existing.source === 'nvd' && record.source !== 'nvd') {
        byCve.set(cve, { ...record, id: cve, cveIds: [cve] });
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
