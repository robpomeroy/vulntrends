/**
 * Zod schemas for build-time validation of generated JSON data.
 * Run via `npm run data:validate`.
 */

import { z } from 'zod';

export const sourceIdSchema = z.enum([
  'mozilla',
  'chrome',
  'msrc',
  'apple',
  'projectzero',
  'pan',
  'fortinet',
  'cisco',
  'adobe',
  'nvd',
  'osv',
]);

export const severitySchema = z.enum(['critical', 'high', 'medium', 'low']);

/**
 * Provenance metadata schema (see E6 in docs/plans/2026-07-22-improvement-plan.md).
 * Attached to each record by the pipeline orchestrator so downstream
 * consumers (CSV downloads, click-through pages) can cite where each
 * data point came from.
 */
export const provenanceSchema = z.object({
  fetchedAt: z.string().datetime(),
  source: sourceIdSchema,
  sourceVersion: z.string().optional(),
});

export const vulnerabilityRecordSchema = z.object({
  id: z.string().min(1),
  source: sourceIdSchema,
  manufacturer: z.string().min(1),
  product: z.string().optional(),
  // Title is required and must be non-empty after trimming. The per-source
  // parsers are responsible for falling back to the advisory ID when the
  // source HTML doesn't provide a human-readable title (e.g. empty link
  // text in Mozilla/Apple), so this contract can be enforced strictly.
  title: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, 'title must be non-empty'),
  severity: severitySchema.optional(),
  cvss: z.number().min(0).max(10).optional(),
  discoveredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  publishedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  patchedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  patchLagDays: z.number().int().optional(),
  cveIds: z.array(z.string()).optional(),
  rawUrl: z.string().url().optional(),
  provenance: provenanceSchema.optional(),
});

/**
 * Per-source operational metadata. See SourceMeta in scripts/pipeline/types.ts.
 */
export const sourceMetaSchema = z.object({
  fetchDurationMs: z.number().int().nonnegative(),
  cachedFallback: z.boolean(),
  minDiscoveredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maxDiscoveredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const pipelineMetaSchema = z.object({
  lastUpdated: z.string().datetime(),
  sourceCounts: z.record(sourceIdSchema, z.number().int()),
  totalRecords: z.number().int(),
  sources: z.record(sourceIdSchema, sourceMetaSchema).optional(),
});

// Date format patterns for aggregated chart points.
// Monthly buckets are "YYYY-MM"; yearly buckets are "YYYY". The chart
// components use D3 date parsers for these formats, so any other shape
// would produce "Invalid Date" at runtime.
const MONTHLY_DATE_REGEX = /^\d{4}-\d{2}$/;
const YEARLY_DATE_REGEX = /^\d{4}$/;

export const timeSeriesPointSchema = z.object({
  date: z.string().regex(MONTHLY_DATE_REGEX).or(z.string().regex(YEARLY_DATE_REGEX)),
  manufacturer: z.string(),
  count: z.number().int(),
});

export const patchLagPointSchema = z.object({
  date: z.string().regex(MONTHLY_DATE_REGEX).or(z.string().regex(YEARLY_DATE_REGEX)),
  manufacturer: z.string(),
  medianLagDays: z.number(),
  p90LagDays: z.number(),
  // Records with a known (non-zero) patch lag in this bucket
  knownCount: z.number().int(),
  // Total records in this bucket (denominator for data confidence)
  totalCount: z.number().int(),
});

export const backlogPointSchema = z.object({
  date: z.string().regex(MONTHLY_DATE_REGEX).or(z.string().regex(YEARLY_DATE_REGEX)),
  manufacturer: z.string(),
  openCount: z.number().int(),
});

/**
 * Severity-mix chart data (see E3 in docs/plans/2026-07-22-improvement-plan.md).
 * Tracks the number of CVEs at each severity bucket per time bucket.
 * Together the four rows for a given date form the percentage stack.
 */
export const severityMixPointSchema = z.object({
  date: z.string().regex(MONTHLY_DATE_REGEX).or(z.string().regex(YEARLY_DATE_REGEX)),
  severity: severitySchema,
  count: z.number().int(),
});

export const manufacturerInfoSchema = z.object({
  name: z.string(),
  colour: z.string(),
});

// Array wrappers
export const vulnerabilityRecordArraySchema = z.array(vulnerabilityRecordSchema);
export const timeSeriesPointArraySchema = z.array(timeSeriesPointSchema);
export const patchLagPointArraySchema = z.array(patchLagPointSchema);
export const backlogPointArraySchema = z.array(backlogPointSchema);
export const severityMixPointArraySchema = z.array(severityMixPointSchema);
export const manufacturerInfoArraySchema = z.array(manufacturerInfoSchema);

// Type exports for use in Astro components
export type VulnerabilityRecordParsed = z.infer<typeof vulnerabilityRecordSchema>;
export type TimeSeriesPointParsed = z.infer<typeof timeSeriesPointSchema>;
export type PatchLagPointParsed = z.infer<typeof patchLagPointSchema>;
export type BacklogPointParsed = z.infer<typeof backlogPointSchema>;
export type SeverityMixPointParsed = z.infer<typeof severityMixPointSchema>;
export type ManufacturerInfoParsed = z.infer<typeof manufacturerInfoSchema>;
