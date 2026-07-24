/**
 * Canonical vulnerability record schema.
 *
 * All data source parsers produce records conforming to this type. The pipeline
 * orchestrator writes per-source raw JSON, then merges and deduplicates records
 * by CVE ID for the combined `src/data/raw/all.json` output.
 */

/** Identifiers for the data sources we ingest. */
export type SourceId =
  | 'mozilla'
  | 'chrome'
  | 'msrc'
  | 'apple'
  | 'projectzero'
  | 'pan'
  | 'fortinet'
  | 'cisco'
  | 'adobe'
  | 'nvd'
  | 'osv';

/** Severity levels, ordered from most to least severe. */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

/**
 * A single normalised vulnerability record.
 *
 * Dates are ISO 8601 strings (`YYYY-MM-DD`). Fields marked optional may be
 * absent when the source does not provide them.
 */
export interface VulnerabilityRecord {
  /** Unique identifier — CVE ID or vendor advisory ID. */
  id: string;
  /** Source the record was fetched from. */
  source: SourceId;
  /** Normalised manufacturer name (e.g. "Mozilla", "Google", "Microsoft"). */
  manufacturer: string;
  /** Product name if available (e.g. "Firefox", "Chrome", "Windows 11"). */
  product?: string;
  /** Short human-readable title or summary. */
  title: string;
  /** Severity rating if the source provides one. */
  severity?: Severity;
  /** CVSS v3.x base score (0–10) if available. */
  cvss?: number;
  /** Date the vulnerability was first reported/discovered. */
  discoveredDate: string;
  /** Date the advisory was published. May differ from discoveredDate. */
  publishedDate?: string;
  /** Date a patch was released, if available. */
  patchedDate?: string;
  /** Days between discoveredDate and patchedDate (computed during normalisation). */
  patchLagDays?: number;
  /** Associated CVE IDs (a single advisory may cover multiple CVEs). */
  cveIds?: string[];
  /** URL to the original advisory or issue. */
  rawUrl?: string;
  /**
   * Provenance metadata — when and from where this record was fetched.
   * Enables audit trails and drift detection (see docs/plans/
   * 2026-07-22-improvement-plan.md §E6).
   */
  provenance?: Provenance;
}

/**
 * Provenance metadata attached to each vulnerability record. Captures the
 * pipeline run that produced the record so downstream consumers (the
 * click-through pages, CSV downloads) can cite exactly where each data
 * point came from.
 */
export interface Provenance {
  /** ISO timestamp when the source was fetched. */
  fetchedAt: string;
  /** Source identifier (same as `record.source`, denormalised for clarity). */
  source: SourceId;
  /** Optional source-specific version string (e.g. MSRC update ID). */
  sourceVersion?: string;
}

/**
 * Metadata written to `src/data/meta.json` by the pipeline.
 */
export interface PipelineMeta {
  /** ISO timestamp of the last successful pipeline run. */
  lastUpdated: string;
  /** Number of records per source. */
  sourceCounts: Record<SourceId, number>;
  /** Total records across all sources (after deduplication). */
  totalRecords: number;
  /**
   * Per-source operational metadata. Added with the E4 extension
   * (see docs/plans/2026-07-22-improvement-plan.md). Surfaces
   * duration, cached-fallback status, and date-range coverage so
   * the operator can diagnose a degrading source before it fails.
   */
  sources?: Partial<Record<SourceId, SourceMeta>>;
}

/**
 * Per-source metadata. The date range is the min/max `discoveredDate`
 * across that source's records. `cachedFallback` is true when this
 * source's records came from the previous run's cache (see pipeline/
   * index.ts §silent-empty safeguard).
 */
export interface SourceMeta {
  /** Wall-clock duration of the source's fetch in milliseconds. */
  fetchDurationMs: number;
  /** True if the records came from a cached fallback, not a fresh fetch. */
  cachedFallback: boolean;
  /** Earliest `discoveredDate` across this source's records (ISO date). */
  minDiscoveredDate?: string;
  /** Latest `discoveredDate` across this source's records (ISO date). */
  maxDiscoveredDate?: string;
}

/** Aggregated time-series data point for discovered/fixed charts. */
export interface TimeSeriesPoint {
  /** Date bucket — "YYYY-MM" for monthly, "YYYY" for yearly. */
  date: string;
  /** Manufacturer name. */
  manufacturer: string;
  /** Count of vulnerabilities in this bucket. */
  count: number;
}

/** Aggregated patch-lag data point. */
export interface PatchLagPoint {
  /** Date bucket — "YYYY-MM" for monthly, "YYYY" for yearly. */
  date: string;
  /** Manufacturer name. */
  manufacturer: string;
  /** Median patch lag in days. */
  medianLagDays: number;
  /** 90th percentile patch lag in days. */
  p90LagDays: number;
  /**
   * Number of records in this bucket with a known patch lag — i.e. a record
   * that has a patch date and a distinct discovery date (not the vendor proxy
   * case where discoveredDate === patchedDate, which yields a misleading 0).
   */
  knownCount: number;
  /**
   * Number of records in this bucket that had a patch date (used as
   * the denominator for data confidence). Records with a patch date
   * but no known discovery date are excluded from the lag calculation
   * but still counted here so the UI can show "X% of fixed records
   * have a known patch lag".
   */
  totalCount: number;
}

/** Aggregated backlog data point. */
export interface BacklogPoint {
  /** Date bucket — "YYYY-MM" for monthly, "YYYY" for yearly. */
  date: string;
  /** Manufacturer name. */
  manufacturer: string;
  /** Number of vulnerabilities discovered but not yet patched at this date. */
  openCount: number;
}

/** Manufacturer metadata for the filter UI and chart colours. */
export interface ManufacturerInfo {
  /** Display name. */
  name: string;
  /** CSS colour value (hex or named). */
  colour: string;
}
