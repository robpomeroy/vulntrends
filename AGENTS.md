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
sources fail. The pipeline has three safeguards:

1. **Defensive fetching.** All source parsers go through
   `scripts/pipeline/fetch-with-retry.ts`, which adds:
   - **Timeout** (30s default, 60s for Adobe which is genuinely slow)
   - **Retry with exponential backoff** (4 attempts: initial + 3 retries with
     1s, 2s, 4s + ±200ms
   - **Retryable status codes** are 429/502/503/504 only — other 4xx
     fail fast because they won't fix themselves

2. **Cached fallback.** When a source fetch throws, the pipeline reads
   the existing `src/data/raw/<source>.json` from the previous run and
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

## Data sources

| Source | Type | Notes |
|---|---|---|
| Mozilla MFSA | JSON feed | Well-structured, good patch-timing data |
| Microsoft MSRC | CVRF API | Structured JSON, requires API key |
| Project Zero | Issue tracker API | Rich disclosure timeline metadata |
| NVD/CVE | REST API | Cross-vendor canonical source, requires `NVD_API_KEY` |
| Google Chrome | HTML scraping | Chrome Releases blog, patch dates vary |
| Apple | HTML scraping | Defensive parser with NVD fallback on failure |
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
