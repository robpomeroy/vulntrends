/**
 * Build-time data loaders.
 *
 * These functions read pre-generated JSON from `src/data/` and return typed
 * data for use in Astro components. They run at build time only — never
 * client-side.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  BacklogPoint,
  ManufacturerInfo,
  PatchLagPoint,
  PipelineMeta,
  TimeSeriesPoint,
} from '../../scripts/pipeline/types.js';

// During Astro build, import.meta.url may resolve to a Vite-internal path.
// Use process.cwd() as a fallback to find the project root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
const AGG_DIR = join(DATA_DIR, 'aggregated');

// Fallback: if the primary path doesn't work, try from cwd
const DATA_DIR_FALLBACK = resolve(process.cwd(), 'src', 'data');
const AGG_DIR_FALLBACK = join(DATA_DIR_FALLBACK, 'aggregated');

async function loadJson<T>(path: string): Promise<T> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as T;
}

/** Try loading from the primary path, fall back to cwd-based path. */
async function loadJsonWithFallback<T>(primaryPath: string, fallbackPath: string): Promise<T> {
  try {
    return await loadJson<T>(primaryPath);
  } catch {
    return await loadJson<T>(fallbackPath);
  }
}

/** Load the pipeline metadata (last updated timestamp, counts). */
export async function loadMeta(): Promise<PipelineMeta | null> {
  try {
    return await loadJsonWithFallback<PipelineMeta>(
      join(DATA_DIR, 'meta.json'),
      join(DATA_DIR_FALLBACK, 'meta.json'),
    );
  } catch {
    return null;
  }
}

/** Load the manufacturer list with colours. */
export async function loadManufacturers(): Promise<ManufacturerInfo[]> {
  try {
    return await loadJsonWithFallback<ManufacturerInfo[]>(
      join(AGG_DIR, 'manufacturers.json'),
      join(AGG_DIR_FALLBACK, 'manufacturers.json'),
    );
  } catch {
    return [];
  }
}

/** Load discovered-by-month time series. */
export async function loadDiscoveredByMonth(): Promise<TimeSeriesPoint[]> {
  return loadJsonWithFallback<TimeSeriesPoint[]>(
    join(AGG_DIR, 'discovered-by-month.json'),
    join(AGG_DIR_FALLBACK, 'discovered-by-month.json'),
  );
}

/** Load fixed-by-month time series. */
export async function loadFixedByMonth(): Promise<TimeSeriesPoint[]> {
  return loadJsonWithFallback<TimeSeriesPoint[]>(
    join(AGG_DIR, 'fixed-by-month.json'),
    join(AGG_DIR_FALLBACK, 'fixed-by-month.json'),
  );
}

/** Load patch-lag-by-month time series. */
export async function loadPatchLagByMonth(): Promise<PatchLagPoint[]> {
  return loadJsonWithFallback<PatchLagPoint[]>(
    join(AGG_DIR, 'patch-lag-by-month.json'),
    join(AGG_DIR_FALLBACK, 'patch-lag-by-month.json'),
  );
}

/** Load backlog-by-month time series. */
export async function loadBacklogByMonth(): Promise<BacklogPoint[]> {
  return loadJsonWithFallback<BacklogPoint[]>(
    join(AGG_DIR, 'backlog-by-month.json'),
    join(AGG_DIR_FALLBACK, 'backlog-by-month.json'),
  );
}

/** Load discovered-by-year time series. */
export async function loadDiscoveredByYear(): Promise<TimeSeriesPoint[]> {
  return loadJsonWithFallback<TimeSeriesPoint[]>(
    join(AGG_DIR, 'discovered-by-year.json'),
    join(AGG_DIR_FALLBACK, 'discovered-by-year.json'),
  );
}

/** Load fixed-by-year time series. */
export async function loadFixedByYear(): Promise<TimeSeriesPoint[]> {
  return loadJsonWithFallback<TimeSeriesPoint[]>(
    join(AGG_DIR, 'fixed-by-year.json'),
    join(AGG_DIR_FALLBACK, 'fixed-by-year.json'),
  );
}

/** Load patch-lag-by-year time series. */
export async function loadPatchLagByYear(): Promise<PatchLagPoint[]> {
  return loadJsonWithFallback<PatchLagPoint[]>(
    join(AGG_DIR, 'patch-lag-by-year.json'),
    join(AGG_DIR_FALLBACK, 'patch-lag-by-year.json'),
  );
}

/** Load backlog-by-year time series. */
export async function loadBacklogByYear(): Promise<BacklogPoint[]> {
  return loadJsonWithFallback<BacklogPoint[]>(
    join(AGG_DIR, 'backlog-by-year.json'),
    join(AGG_DIR_FALLBACK, 'backlog-by-year.json'),
  );
}

/**
 * Load all data needed for the dashboard in a single call.
 * Returns null for datasets that don't exist yet (before first pipeline run).
 */
export async function loadDashboardData() {
  const [meta, manufacturers, discoveredMonth, fixedMonth, patchLagMonth, backlogMonth, discoveredYear, fixedYear, patchLagYear, backlogYear] =
    await Promise.all([
      loadMeta(),
      loadManufacturers(),
      loadDiscoveredByMonth().catch(() => []),
      loadFixedByMonth().catch(() => []),
      loadPatchLagByMonth().catch(() => []),
      loadBacklogByMonth().catch(() => []),
      loadDiscoveredByYear().catch(() => []),
      loadFixedByYear().catch(() => []),
      loadPatchLagByYear().catch(() => []),
      loadBacklogByYear().catch(() => []),
    ]);

  return {
    meta,
    manufacturers,
    discoveredMonth,
    fixedMonth,
    patchLagMonth,
    backlogMonth,
    discoveredYear,
    fixedYear,
    patchLagYear,
    backlogYear,
  };
}
