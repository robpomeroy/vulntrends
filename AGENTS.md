# VulnTrends — Agent Guide

## Project overview

VulnTrends is an open-source, data-driven website that visualises trends in
vulnerability patching across major software manufacturers. The core objective
is to surface any obvious trends caused by the advent of AI-driven vulnerability
discovery and software patching. The site presents data neutrally — no
annotations or editorial framing — and lets users draw their own conclusions.

## Tech stack

- **Framework**: Astro 7 (static site generation)
- **Interactive components**: Svelte 5 islands (hydrated controls + D3 charts)
- **Visualisation**: D3.js (vanilla, wrapped in Svelte components)
- **Styling**: Tailwind CSS (dark-first dashboard aesthetic)
- **Data validation**: Zod schemas
- **Pipeline tooling**: tsx + TypeScript (Node 22+)
- **Deployment**: Synology NAS scheduled task → rsync to Namecheap web host

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start the Astro dev server at `localhost:4321` |
| `npm run build` | Build the production site to `dist/` (reads pre-generated JSON only) |
| `npm run preview` | Preview the built site locally |
| `npm run data:build` | **Standalone tool**: fetch all sources, normalise, aggregate into `src/data/` |
| `npm run data:validate` | Validate all generated JSON against Zod schemas |
| `npm run data:sample` | Generate small synthetic dataset (offline; uses `scripts/generate-sample-data.ts`) |
| `npm run publish` | Full pipeline: data refresh + validate + build + rsync to production |
| `npm run publish:staging` | Same, but deploy to staging path |
| `npm run publish:dry-run` | Full pipeline minus rsync (test without deploying) |
| `npm run publish:data` | Fetch + aggregate only (delegates to `publish.ts --only=data:build`) |
| `npm run publish:validate` | Zod schema check only (`publish.ts --only=data:validate`) |
| `npm run publish:build` | Data + validate + build, no deploy (`publish.ts --only=data:build,data:validate,build`) |
| `npm run publish:upload` | rsync existing `dist/` only (`publish.ts --only=rsync`) — refuses if `dist/` is missing |
| `npm run publish:upload:dry-run` | Show what rsync would do (`publish.ts --only=rsync --dry-run`) |
| `npm run publish:skip-data` | Deploy existing `dist/` without re-fetching data (`publish.ts --skip=data:build`) |

### Data build is decoupled from site build

`data:build` scrapes/downloads from vendor sources and aggregates into
`src/data/`. `astro build` only reads that JSON — it never triggers scraping.
This lets you iterate on the website freely without re-downloading data.

**Local dev workflow**: run `npm run data:build` once, then `npm run dev` freely.

### Data pipeline resilience

A scheduled `npm run publish` must not deploy a degraded site when
sources fail. The pipeline has four safeguards:

1. **Defensive fetching.** All source parsers go through
   `scripts/pipeline/fetch-with-retry.ts`, which adds:
   - **Timeout** (30s default, 60s for Adobe which is genuinely slow)
   - **Retry with exponential backoff** (4 attempts: initial + 3 retries with
     1s, 2s, 4s + ±200ms
   - **Retryable status codes** are 429/502/503/504 only — other 4xx
     fail fast because they won't fix themselves

2. **Cached fallback (throw path).** When a source fetch throws, the pipeline
   reads the existing `src/data/raw/<source>.json` from the previous run and
   uses those records instead of overwriting with `[]`. A single
   network hiccup no longer wipes out a healthy previous dataset —
   the deployed site is at worst one run stale.

3. **Failure threshold.** After all sources are fetched, the pipeline
   aborts (exit non-zero) if more than `MAX_SOURCE_FAILURES` (default
   2, configurable via env var) sources failed with no cached data.
   This prevents deploying a degraded site when there's a systemic
   problem (network down, NVD API key expired, DNS broken).

   Sources that fail but had cached data are **not** counted toward
   the threshold — they contribute stale-but-useful records. A
   warning is emitted to stderr listing which sources were stale,
   so the operator can spot a degrading situation before it becomes
   a real problem.

4. **Silent-empty cache fallback.** A previously-working source can
   regress to returning `0` records *without throwing* — e.g. when
   an upstream page changes its HTML shape, an endpoint quietly
   switches response format, or an ad-redirect slips past retry
   logic. Such failures are invisible to safeguard #2 (no exception)
   and to safeguard #3 (no `failedSources` increment), so they would
   silently clobber the raw JSON file with `[]`.

   The orchestrator detects this case in `scripts/pipeline/index.ts`:
   if a source returns 0 records and the previous run had cached data,
   it reuses the cache and surfaces a warning. This is the *most
   important* safeguard because `src/data/*` is gitignored — a
   silent-empty regression cannot be recovered by `git checkout` or
   any other mechanism short of rebuilding from the upstream source.

   **Allow-list for documented zero-record stubs.** Sources that are
   known stubs and always return `[]` (currently `projectzero` and
   `cisco`) are exempt from safeguard #4 via the
   `ZERO_RECORD_ALLOWLIST` set at the top of `index.ts`. When adding
   a new deprecated stub source, add its `SourceId` to that set with
   a comment explaining why. The safeguard would otherwise mask
   real progress when a stub is revived.

The Synology Task Scheduler email surfaces both the threshold-abort
and the cached-fallback warning (both go to stderr).

### Cross-platform `node_modules` (Windows ↔ Linux)

`node_modules/` is gitignored because some dependencies (notably
`esbuild`) ship a platform-specific native binary. If you develop on
Windows and run `npm run publish` on Linux (or vice versa), the wrong
binary is loaded and the very first thing that breaks is the *loader*
of `publish.ts` itself (which is `tsx`, and tsx depends on esbuild)
— so a check that lives *inside* `publish.ts` can never fire.

**Run `npm ci` on each platform once** (Windows, Linux/WSL, macOS) to
install the correct native binaries. After that, every script in
`package.json` that uses tsx is prefixed with
`node scripts/check-platform.mjs &&` — a plain-Node (no tsx, no
esbuild) pre-flight that scans `node_modules/@esbuild/` for the
current platform's variant. If only wrong-platform binaries are
present, it runs `npm ci` automatically and then continues with the original
command.

### Local secrets

The data pipeline reads `NVD_API_KEY` (and optionally `MSRC_API_KEY`) from
`process.env`. The `data:build` and `publish` scripts pass
`--env-file-if-exists=.env` to `tsx`, so dropping your keys in a `.env`
file in the repo root is picked up automatically. Copy `.env.example` to
`.env` to get started.

The `.env` file also holds the `DEPLOY_*` variables used by
`scripts/publish.ts` for rsync to the Namecheap web host (host, port,
user, SSH key path, production/staging paths). See `.env.example` for
the full list.

### Dev server startup time

The dev server may take longer than 30 seconds to start on the first run
because Vite needs to optimise dependencies (Tailwind v4, Svelte 5, D3).
Do not use `astro dev --background` — it has a hardcoded 30s timeout that
will fail before the server is ready. Use `npm run dev` (foreground) instead.
Subsequent starts are faster once the Vite cache is warm.

## Architecture

```
Data sources (vendor advisories, NVD/CVE)
  ↓
scripts/pipeline/sources/*.ts    ← fetchRecords() per source
  ↓
scripts/pipeline/index.ts        ← orchestrator: merge, deduplicate by CVE
  ↓
src/data/raw/<source>.json       ← normalised records (committed to repo)
  ↓
scripts/aggregate.ts             ← build time-series aggregates
  ↓
src/data/aggregated/*.json       ← chart-ready data bundles
  ↓
Astro build (src/lib/load.ts)    ← reads JSON, passes to components
  ↓
Svelte + D3 charts                ← interactive dashboard
```

## Conventions

- **British English** (en-GB) throughout all copy, comments, and documentation.
  Use "colour" not "color", "behaviour" not "behavior", "favour" not "favor".
- **MIT license** — all contributions are MIT licensed.
- **Dark-first design** — the dashboard uses a dark slate/zinc palette.
- **Data integrity** — all generated JSON in `src/data/` must pass Zod
  validation. Never hand-edit files in `src/data/`; they are generated by
  `npm run data:build`.
- **Neutral framing** — do not add AI-era annotations, editorial commentary,
  or interpretive labels to charts or copy. Present data as-is.

### Versioning

- The project version lives in the `version` field of `package.json` —
  that is the single source of truth. Bump it there; nothing else needs
  to change.
- `package-lock.json` mirrors the version automatically on `npm install`.
  Never hand-edit the lockfile's `version` field.
- The site footer reads the version via a JSON import in
  `src/layouts/Dashboard.astro`, so a `package.json` bump is reflected
  on the next `astro build` with no other change. The footer renders
  it as `v<version>` in the "Project" column.
- Follow [semantic versioning](https://semver.org/):
  - **patch** (e.g. `1.0.0` → `1.0.1`) for parser fixes, dependency
    updates, doc corrections, and other changes that don't alter the
    user-visible behaviour of the site or the data schema.
  - **minor** (e.g. `1.0.0` → `1.1.0`) for new data sources, new
    dashboard features, or additive changes to the data schema.
  - **major** (e.g. `1.0.0` → `2.0.0`) for breaking changes to the
    data schema, the site structure, or anything that requires users
    to update tooling that consumes the JSON.
- The `version` field in `.vscode/launch.json` is the VS Code
  launch-config schema version, not the project version. Do not touch
  it when bumping the project.

## Adding a new data source

1. Create a parser at `scripts/pipeline/sources/<vendor>.ts` exporting
   `async function fetchRecords(): Promise<VulnerabilityRecord[]>`.
2. Register the source in `scripts/pipeline/index.ts` (import + add to the
   `sources` array, *before* NVD which is always last as the gap-filler).
3. Add the source ID to the `SourceId` union in `scripts/pipeline/types.ts`
   and to the `sourceCounts` record in `scripts/pipeline/index.ts` and
   `scripts/validate.ts` and `scripts/generate-sample-data.ts`.
4. Add the manufacturer to `MANUFACTURERS` in `src/lib/manufacturers.ts` with
   a display name and colour. If the vendor has a CPE entry in NVD, also
   add it to `VENDOR_QUERIES` in `scripts/pipeline/sources/nvd.ts` and the
   `MANUFACTURER_ALIASES` map in `scripts/pipeline/normalise.ts` for
   cross-source deduplication.
5. Run `npm run data:build` and `npm run data:validate` to verify.

### Caveat: deduplication of records without CVE IDs

`deduplicateRecords` (`scripts/pipeline/normalise.ts`) keys every record
by `record.id` first, then by CVE id. Records that lack a CVE list
(common for "one record per advisory/post" fallback paths) therefore
have `record.id` as their *only* identity. If your parser falls back
to a date-based id (e.g. `chrome-2026-07-15`), two records from the
same date will collide and the later one will be silently dropped.

**For no-CVE fallback records, derive the id from a stable per-record
identifier** — the post URL, the advisory ID, or a hash of the URL.
See `scripts/pipeline/sources/chrome.ts` for the canonical pattern
(`createHash('sha256').update(url).digest('hex').slice(0, 12)`).

## Data sources

| Source | Type | Notes |
|---|---|---|
| Mozilla MFSA | JSON feed | Well-structured, good patch-timing data |
| Microsoft MSRC | CVRF API | Update list is JSON (OData-wrapped); per-update CVRF documents are **XML**, parsed via regex over the CVRF 1.1 schema. `Accept` header is ignored on the per-update path. |
| Project Zero | Issue tracker API | Rich disclosure timeline metadata |
| NVD/CVE | REST API | Cross-vendor canonical source, requires `NVD_API_KEY` |
| Google Chrome | Atom JSON feed | Blogger's Atom feed (`/feeds/posts/default/-/Stable%20updates?alt=json`). HTML scraping is broken (ad-network redirects); do not switch back. |
| Apple | HTML parsing | Index page uses a `<table class="gb-table">` with numeric support-article IDs (e.g. `/en-us/127594`). Old `HT\d{6,9}` link pattern is gone — do not revert to regex over it. |
| Palo Alto | JSON API | `security.paloaltonetworks.com/json` — CVSS + publication dates |
| Fortinet | HTML scraping | `fortiguard.com/psirt` — separate Published and Updated dates give real patch-lag signal |
| Cisco | NVD-only | openVuln API requires OAuth; OXML feed deprecated. Coverage via NVD `cisco` CPE vendor. |
| Adobe | HTML scraping | `helpx.adobe.com/security.html` — per-bulletin CVE fetch is best-effort |

## Documentation

Full Astro documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
