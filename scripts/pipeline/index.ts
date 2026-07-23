/**
 * Pipeline orchestrator.
 *
 * Runs all data source parsers, merges results, deduplicates by CVE ID
 * (preferring vendor-specific data over NVD for timing), and writes
 * normalised records to `src/data/raw/<source>.json`.
 *
 * Also writes `src/data/meta.json` with pipeline metadata.
 *
 * Usage: `npm run data:build` (runs this then aggregate.ts)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { deduplicateByCve, deduplicateRecords } from './normalise.js';
import type { PipelineMeta, SourceId, VulnerabilityRecord } from './types.js';

import { fetchRecords as fetchMozilla } from './sources/mozilla.js';
import { fetchRecords as fetchMsrc } from './sources/msrc.js';
import { fetchRecords as fetchProjectZero } from './sources/projectzero.js';
import { fetchRecords as fetchNvd } from './sources/nvd.js';
import { fetchRecords as fetchChrome } from './sources/chrome.js';
import { fetchRecords as fetchApple } from './sources/apple.js';
import { fetchRecords as fetchPan } from './sources/pan.js';
import { fetchRecords as fetchFortinet } from './sources/fortinet.js';
import { fetchRecords as fetchCisco } from './sources/cisco.js';
import { fetchRecords as fetchAdobe } from './sources/adobe.js';
import { fetchRecords as fetchOsv } from './sources/osv.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', '..', 'src', 'data');
const RAW_DIR = join(DATA_DIR, 'raw');

/**
 * Maximum number of sources allowed to fail *with no cached data* before
 * the pipeline aborts. Configurable via the MAX_SOURCE_FAILURES env
 * var (default 2).
 *
 * "Failed with no cached data" means: the source fetch threw AND no
 * `src/data/raw/<source>.json` from a previous run was available. Sources
 * that fail but have a cached fallback (e.g. NVD's last 12 hours
 * partial) are NOT counted — they contribute stale-but-useful data to
 * the run.
 *
 * The threshold guards against systemic failures (network down, NVD
 * API key expired, DNS broken) nuking a healthy site. A threshold of
 * 2 means: with 10 sources, a single blip is fine, two blips
 * simultaneously is a system-level problem worth investigating.
 */
const MAX_SOURCE_FAILURES = (() => {
  const parsed = Number.parseInt(process.env.MAX_SOURCE_FAILURES ?? '2', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
})();

/** All data sources, in fetch order. NVD is last so it can fill gaps. */
const SOURCES: Array<{ id: SourceId; fetch: () => Promise<VulnerabilityRecord[]> }> = [
  { id: 'mozilla', fetch: fetchMozilla },
  { id: 'msrc', fetch: fetchMsrc },
  { id: 'projectzero', fetch: fetchProjectZero },
  { id: 'chrome', fetch: fetchChrome },
  { id: 'apple', fetch: fetchApple },
  { id: 'pan', fetch: fetchPan },
  { id: 'fortinet', fetch: fetchFortinet },
  { id: 'cisco', fetch: fetchCisco },
  { id: 'adobe', fetch: fetchAdobe },
  // OSV is opt-in: it requires an explicit `OSV_LOOKUP_CVE_LIST` env
  // var pointing to a CVE-ID list (see sources/osv.ts). Without that,
  // the stub returns `[]`. Sources that are expected to legitimately
  // return `[]` are handled by ZERO_RECORD_ALLOWLIST below.
  { id: 'osv', fetch: fetchOsv },
  { id: 'nvd', fetch: fetchNvd },
];

/**
 * Sources that are *expected* to return an empty array on a healthy
 * run. The silent-empty safeguard in the main loop skips these when
 * deciding whether a 0-record result is a parser regression — for
 * them, zero is the correct answer.
 *
 * Add a source here when its parser is a documented stub that always
 * returns `[]` (e.g. because the upstream API was retired). The
 * safeguard still applies to all other sources: a previously-working
 * source that suddenly returns 0 will fall back to the cached
 * `src/data/raw/<source>.json` instead of overwriting with `[]`.
 */
const ZERO_RECORD_ALLOWLIST: ReadonlySet<SourceId> = new Set<SourceId>([
  // Project Zero: source API retired (Monorail endpoint deprecated,
  // migrated to issuetracker.google.com). Coverage comes from NVD's
  // `google` vendor query. See scripts/pipeline/sources/projectzero.ts.
  'projectzero',
  // Cisco: no public advisory feed available (openVuln API requires
  // OAuth; OXML feed deprecated). Coverage comes from NVD's `cisco`
  // vendor query. See scripts/pipeline/sources/cisco.ts.
  'cisco',
  // OSV: opt-in source that returns [] unless `OSV_LOOKUP_CVE_LIST`
  // is configured. The safeguard would otherwise mask a fresh-CVE-list
  // regression on the very first run.
  'osv',
]);

async function writeJson(path: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2) + '\n';
  await writeFile(path, json, 'utf-8');
}

async function main(): Promise<void> {
  console.log('=== VulnTrends data pipeline ===\n');

  // Ensure output directories exist
  await mkdir(RAW_DIR, { recursive: true });

  const sourceCounts: Record<SourceId, number> = {
    mozilla: 0,
    chrome: 0,
    msrc: 0,
    apple: 0,
    projectzero: 0,
    pan: 0,
    fortinet: 0,
    cisco: 0,
    adobe: 0,
    nvd: 0,
    osv: 0,
  };

  const allRecords: VulnerabilityRecord[] = [];

  // Track which sources failed and whether each had a cached fallback.
  // Used at the end to decide whether to abort the pipeline.
  const failedSources: SourceId[] = [];
  const cachedFallbackSources: SourceId[] = [];

  // Per-source timing for the E4 metadata extension. Captures the wall-clock
  // duration of each source fetch so the operator can spot a degrading
  // source before it fails outright.
  const sourceFetchStartedAt = new Map<SourceId, number>();
  const sourceFetchDurationMs = new Map<SourceId, number>();
  // ISO timestamp of the pipeline run — stamped onto every record's
  // provenance field (see E6 in docs/plans/2026-07-22-improvement-plan.md).
  const pipelineRunTimestamp = new Date().toISOString();

  // Fetch each source
  for (const source of SOURCES) {
    console.log(`\n--- ${source.id} ---`);
    const sourceStart = Date.now();
    sourceFetchStartedAt.set(source.id, sourceStart);
    try {
      const records = await source.fetch();
      sourceFetchDurationMs.set(source.id, Date.now() - sourceStart);

      // Attach provenance metadata to every record before downstream
      // processing. The `source` field is redundant with the record's
      // own `source` field but is included for clarity in the
      // per-record provenance object.
      const recordsWithProvenance = records.map((r) => ({
        ...r,
        provenance: {
          fetchedAt: pipelineRunTimestamp,
          source: source.id,
        },
      }));

      // Silent-empty safeguard: if a source's fetch succeeds but
      // extracts zero records, AND the previous run had cached data,
      // reuse the cache instead of overwriting it with []. This
      // catches parser regressions where the source returns 200 OK
      // and a structurally valid but useless payload (e.g. an HTML
      // page that no longer matches the expected shape, an endpoint
      // that quietly changed its response format, an ad-redirect that
      // slips past fetchWithRetry). Without this, a single such
      // regression destroys historical data irrecoverably — the raw
      // files are gitignored, so `git checkout` can't restore them.
      //
      // Sources in ZERO_RECORD_ALLOWLIST (documented stubs that
      // legitimately return []) are exempt: for them, 0 records is
      // the correct answer and the safeguard would only mask real
      // progress when a stub is revived.
      if (records.length === 0 && !ZERO_RECORD_ALLOWLIST.has(source.id)) {
        const prevPath = join(RAW_DIR, `${source.id}.json`);
        try {
          const prevJson = await readFile(prevPath, 'utf-8');
          const prevRecords = JSON.parse(prevJson) as VulnerabilityRecord[];
          if (Array.isArray(prevRecords) && prevRecords.length > 0) {
            sourceCounts[source.id] = prevRecords.length;
            allRecords.push(...prevRecords);
            cachedFallbackSources.push(source.id);
            console.error(
              `  ⚠ ${source.id}: fetch returned 0 records; reusing ${prevRecords.length} cached records from previous run`,
            );
            // Skip the empty-array write below.
            continue;
          }
        } catch {
          // No previous file (first run) or JSON parse error — fall
          // through to writing the empty array as normal.
        }
      }

      sourceCounts[source.id] = recordsWithProvenance.length;
      allRecords.push(...recordsWithProvenance);

      // Write per-source raw JSON
      await writeJson(join(RAW_DIR, `${source.id}.json`), recordsWithProvenance);
      console.log(`  Written ${recordsWithProvenance.length} records to raw/${source.id}.json`);
    } catch (err) {
      console.error(`  ERROR fetching ${source.id}:`, err);

      // Try to keep the previous run's data instead of overwriting
      // with an empty array. Without this, a single network hiccup
      // on the live site would wipe out a perfectly good previous
      // dataset. The next aggregator run still sees the cached
      // records, so the deployed site is at worst one run stale.
      const prevPath = join(RAW_DIR, `${source.id}.json`);
      let usedCache = false;
      try {
        const prevJson = await readFile(prevPath, 'utf-8');
        const prevRecords = JSON.parse(prevJson) as VulnerabilityRecord[];
        if (Array.isArray(prevRecords) && prevRecords.length > 0) {
          sourceCounts[source.id] = prevRecords.length;
          allRecords.push(...prevRecords);
          usedCache = true;
          cachedFallbackSources.push(source.id);
          // Log to stderr so the Synology Task Scheduler email surfaces
          // it (errors are normally sent to stderr; stdout goes to the
          // log file). The user asked for visibility on cached-fallback
          // usage so this is emitted even though it's not a hard error.
          console.error(
            `  ⚠ ${source.id}: fetch failed; reusing ${prevRecords.length} cached records from previous run`,
          );
        }
      } catch {
        // No previous file (first run) or JSON parse error — fall
        // through to writing an empty array.
      }
      if (!usedCache) {
        // True failure: no fresh data, no cached data. Write an empty
        // array so the file exists and downstream code doesn't break
        // (the Zod schemas require a JSON array, not absence).
        sourceCounts[source.id] = 0;
        await writeJson(prevPath, []);
        failedSources.push(source.id);
        console.error(
          `  ✗ ${source.id}: fetch failed AND no previous data available; wrote empty array`,
        );
      }
    }
  }

  // Pre-aggregation safety check: if too many sources failed with no
  // cached data, abort the pipeline before aggregating and writing
  // meta.json. This prevents `npm run publish` from building and
  // deploying a degraded site when there's a systemic problem (e.g.
  // network down, API key expired, DNS broken).
  if (failedSources.length > MAX_SOURCE_FAILURES) {
    console.error('');
    console.error(`✗ Pipeline aborted: ${failedSources.length} sources failed with no cached data`);
    console.error(`  Failed: ${failedSources.join(', ')}`);
    console.error(`  Threshold (MAX_SOURCE_FAILURES): ${MAX_SOURCE_FAILURES}`);
    console.error(
      `  Fix the failing sources or increase the threshold via the env var.`,
    );
    process.exit(1);
  }

  // Surface cached-fallback usage to stderr even on success, so the
  // operator can see which sources were stale.
  if (cachedFallbackSources.length > 0) {
    console.error(
      `⚠ ${cachedFallbackSources.length} source(s) used cached data: ${cachedFallbackSources.join(', ')}`,
    );
  }

  // Deduplicate — first by record ID, then by CVE ID
  console.log('\n=== Deduplication ===');
  console.log(`Total records before dedup: ${allRecords.length}`);
  const deduped = deduplicateByCve(deduplicateRecords(allRecords));
  console.log(`Total records after dedup: ${deduped.length}`);

  // Write merged raw file
  await writeJson(join(RAW_DIR, 'all.json'), deduped);

  // Compute per-source metadata (E4 extension). For each source,
  // calculate the min/max discoveredDate across its records in the
  // post-dedup dataset so the operator can see at a glance which
  // sources have full historical coverage.
  const perSource: Partial<Record<SourceId, {
    fetchDurationMs: number;
    cachedFallback: boolean;
    minDiscoveredDate?: string;
    maxDiscoveredDate?: string;
  }>> = {};
  const dateRanges: Record<SourceId, { min: string; max: string }> = {} as Record<SourceId, { min: string; max: string }>;
  for (const r of deduped) {
    const cur = dateRanges[r.source];
    if (!cur) {
      dateRanges[r.source] = { min: r.discoveredDate, max: r.discoveredDate };
    } else {
      if (r.discoveredDate < cur.min) cur.min = r.discoveredDate;
      if (r.discoveredDate > cur.max) cur.max = r.discoveredDate;
    }
  }
  for (const id of Object.keys(SOURCES.reduce((acc, s) => ({ ...acc, [s.id]: true }), {} as Record<string, boolean>)) as SourceId[]) {
    const range = dateRanges[id];
    // Always emit an entry for every source, even if it has zero
    // records (stubs, opt-in sources like OSV). Without this, the
    // schema's `record(SourceId, …)` expects a key for every source.
    perSource[id] = {
      fetchDurationMs: sourceFetchDurationMs.get(id) ?? 0,
      cachedFallback: cachedFallbackSources.includes(id),
      minDiscoveredDate: range?.min,
      maxDiscoveredDate: range?.max,
    };
  }

  // Write metadata
  const meta: PipelineMeta = {
    lastUpdated: new Date().toISOString(),
    sourceCounts,
    totalRecords: deduped.length,
    sources: perSource,
  };
  await writeJson(join(DATA_DIR, 'meta.json'), meta);

  console.log('\n=== Pipeline complete ===');
  console.log(`Meta written to src/data/meta.json`);
  console.log(`Raw records written to src/data/raw/`);
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
