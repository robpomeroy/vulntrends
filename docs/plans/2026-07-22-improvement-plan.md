# VulnTrends Improvement Plan — 2026-07-22

Status: ACTIVE — work in progress, tracking implementation.

## Executive Summary

After running `npm run data:build` and analysing the output, the dashboard is
currently publishing **materially misleading data**. The most urgent issue is
not the historical-coverage question — it is a live data-integrity defect in
the MSRC source that stamps ~25,000 historical CVEs with 2026 dates,
producing a 6× spike on the "Discovered" chart that a reader would reasonably
interpret as a real surge in vulnerability disclosure. Below is a
prioritised plan covering data integrity, historical coverage, data
retention/caching, click-through pages, and further data-quality hardening.
Reviewed from a senior enterprise-architect (cybersecurity) perspective and
folded those refinements in.

## Implementation Phases

### Phase 1 — Critical Data Integrity (STOP THE BLEEDING)

| # | Item | Description |
|---|---|---|
| A1 | MSRC `CurrentReleaseDate` contamination | MSRC CVRF `CurrentReleaseDate` is "when this CVRF doc was last refreshed", not "when the CVE was disclosed". Fix: extract `<vuln:InitialNotificationDate>` per vulnerability and use as `discoveredDate`/`patchedDate`. Fallback to `CurrentReleaseDate` only when absent. Add aggregator-level outlier guard. |
| A2 | CVE-year vs discovered-year sanity check | If `|CVEYear − discoveredYear| > 2`, flag the record. Semantic validator in `scripts/data-audit.ts`. |
| A3 | Future-dated record guard | Records dated beyond `today + 7 days` are almost always parser bugs. Hard-fail validator. |

### Phase 2 — Historical Coverage & Completeness

| # | Item | Description |
|---|---|---|
| B1 | Default date range to 2013+ with caveat band | Pre-2013 data is opportunistic samples (vendors lacked advisory programmes). Full-coverage era = 2013+. Partial-coverage era = 1999–2012 (annotated). Hide pre-1999 by default. |
| B2 | Add OSV (osv.dev) as authoritative historical source | Single API that reconciles vendor + NVD data, good historical depth, clean schema. New source adapter. |
| B3 | Extend dedup precedence | vendor advisory > OSV > NVD. |

### Phase 3 — Data Retention, Caching & Integrity

| # | Item | Description |
|---|---|---|
| C2 | Tiered retention strategy (T2 snapshots) | Daily copies of `raw/all.json` + `meta.json` to local `data-archive/<YYYY-MM-DD>/`; replicated to `ARCHIVE_RSYNC_TARGET` via rsync (not committed to Git — production Git is read-only). Recovery source, audit trail, reproducibility. |
| C3 | Snapshot integrity verification | `sha256sum` per snapshot in `data-archive/manifest.json`. Detect bit-rot and accidental edits. Manifest lives at the rsync target, not in Git. |
| E6 | Provenance tracking per record | `provenance: { source, fetchedAt, sourceVersion? }` field. Enables audit trail for cybersecurity-adjacent credibility. |

### Phase 4 — Chart Click-Through Pages

| # | Item | Description |
|---|---|---|
| D1 | Four new routes under `src/pages/charts/` | discovered.astro, fixed.astro, patch-lag.astro, backlog.astro |
| D2 | Dashboard integration | Chart card titles link to click-through pages. |
| D3 | Shared chart component refactor | `StackedAreaChart`/`PatchLagChart` accept `height` prop. |
| D4 | CSV download format | Tidy CSV per chart, generated at build time. |

### Phase 5 — Deeper Coverage

| # | Item | Description |
|---|---|---|
| B2 | OSV source adapter | See Phase 2. |
| B3 | Dedup precedence | See Phase 2. |

### Phase 6 — Quality Hardening

| # | Item | Description |
|---|---|---|
| E1 | NVD `published` ≠ `discovered` | Semantic labelling; or adopt OSV semantics. |
| E2 | Backlog inflation from missing patch dates | Cap backlog by "stale" horizon (5 years); annotate. |
| E3 | Severity distribution chart | Fifth chart using existing severity/cvss fields. |
| E4 | Source-level metadata in meta.json | Per-source `dateRange`, `cachedFallback`, `fetchDurationMs`. |
| E5 | Semantic data-audit script | Runs after `data:validate`. Checks CVE-year, future-dating, YoY outliers, coverage %, dup CVE IDs. |

## Enterprise-Architect Refinements

1. **Trust model.** Provenance (E6) + snapshot archive (C2) = audit trail.
2. **Supply-chain risk of OSV.** Treat as third-party dependency; NVD as redundant cross-check.
3. **Immutability.** T2 archive append-only on the backup target; rsync `--delete` only removes snapshots already pruned locally by the retention policy. No Git-based immutability (production has read-only Git access).
4. **Data-loss scenarios.** `git push` as last step in `daily-publish.sh` = off-site backup.
5. **CVE as regulated identifier.** Preserve CVE-id dedup; CVE-year sanity check works because CVE IDs encode assignment year.
6. **Drift detection.** Weekly diff of snapshots to detect upstream rewrites (catches next MSRC-style bulk re-stamp).
7. **T3 scope.** Limit raw-payload archival to MSRC + NVD only.
8. **SEO.** Chart-explanation pages = long-form keyword-rich content. Add JSON-LD `Dataset` schema.

## Implementation Order

1. Phase 1 (A1–A3) — stop misleading data.
2. Phase 2 (B1) — historical honesty.
3. Phase 3 (C2, C3, E6) — retention foundation.
4. Phase 4 (D1–D4) — click-through pages.
5. Phase 5 (B2, B3) — OSV source.
6. Phase 6 (E1–E5) — continuous hardening.

## Implementation Notes

- The chart-explanation content collection was originally named
  `chart-explanations` (with a hyphen) but Astro 7's glob loader
  silently failed to populate it on Windows. Renaming the
  collection (and the key Astro uses) to `chartExplanations`
  (camelCase) fixed the issue. If a future Astro version restores
  the hyphen support, the directory can be renamed for consistency
  with `blog`.
- The backlog chart's stale horizon (`BACKLOG_STALE_YEARS`,
  default 5) is reflected in the about page and the
  `backlog.md` explanation.

## Progress Tracking

- [x] A1: MSRC date semantics fix
- [x] A2: CVE-year sanity validator
- [x] A3: Future-date validator
- [x] B1: Default 2013+ range + caveat band
- [x] B2: OSV source adapter (opt-in, stub-mode by default)
- [x] B3: Dedup precedence (vendor > OSV > NVD)
- [x] C2: Snapshot archive
- [x] C3: Manifest with sha256
- [x] D1: Click-through chart pages (5 total)
- [x] D2: Dashboard links to click-throughs
- [x] D3: Shared chart height prop
- [x] D4: CSV downloads
- [x] E1: NVD published vs discovered labelling (documented in explanations)
- [x] E2: Backlog stale-horizon (5 years, configurable)
- [x] E3: Severity mix chart
- [x] E4: Source-level meta.json
- [x] E5: Semantic data-audit script
- [x] E6: Provenance tracking

## Verification

- `npm run data:validate` → 23/23 files pass
- `npm run data:audit` → 5 warnings, 0 errors (correctly surfacing A2/E2)
- `npm run data:csv` → 5 CSVs with provenance headers
- `npm run data:archive` → 12 files verified, sha256 manifest
- `npm run build` → 10 pages (5 chart click-throughs + 5 existing)