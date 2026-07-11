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
  'nvd',
]);

export const severitySchema = z.enum(['critical', 'high', 'medium', 'low']);

export const vulnerabilityRecordSchema = z.object({
  id: z.string().min(1),
  source: sourceIdSchema,
  manufacturer: z.string().min(1),
  product: z.string().optional(),
  title: z.string().min(1),
  severity: severitySchema.optional(),
  cvss: z.number().min(0).max(10).optional(),
  discoveredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  publishedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  patchedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  patchLagDays: z.number().int().optional(),
  cveIds: z.array(z.string()).optional(),
  rawUrl: z.url().optional(),
});

export const pipelineMetaSchema = z.object({
  lastUpdated: z.iso.datetime(),
  sourceCounts: z.record(sourceIdSchema, z.number().int()),
  totalRecords: z.number().int(),
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
  count: z.number().int(),
});

export const backlogPointSchema = z.object({
  date: z.string().regex(MONTHLY_DATE_REGEX).or(z.string().regex(YEARLY_DATE_REGEX)),
  manufacturer: z.string(),
  openCount: z.number().int(),
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
export const manufacturerInfoArraySchema = z.array(manufacturerInfoSchema);

// Type exports for use in Astro components
export type VulnerabilityRecordParsed = z.infer<typeof vulnerabilityRecordSchema>;
export type TimeSeriesPointParsed = z.infer<typeof timeSeriesPointSchema>;
export type PatchLagPointParsed = z.infer<typeof patchLagPointSchema>;
export type BacklogPointParsed = z.infer<typeof backlogPointSchema>;
export type ManufacturerInfoParsed = z.infer<typeof manufacturerInfoSchema>;
