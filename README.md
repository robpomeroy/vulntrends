# VulnTrends

Tracking trends in vulnerability patching across major software manufacturers.

VulnTrends is an open-source, data-driven dashboard that visualises
vulnerability patching trends over time. It draws data from vendor security
advisories (Mozilla, Google, Microsoft, Apple, Project Zero) and the NVD/CVE
database, then presents interactive charts showing:

- Vulnerabilities discovered
- Vulnerabilities fixed
- Time between discovery and patch
- Vulnerability backlogs

The site presents data neutrally — no annotations or editorial framing —
letting users draw their own conclusions from the visualised trends.

## Tech stack

- **Framework**: Astro 7 (static site generation)
- **Interactive components**: Svelte 5 islands
- **Visualisation**: D3.js
- **Styling**: Tailwind CSS v4 (dark-first dashboard aesthetic)
- **Data validation**: Zod
- **Pipeline tooling**: tsx + TypeScript (Node 24+)
- **Deployment**: GitHub Pages via GitHub Actions

## Getting started

```sh
# Install dependencies
npm install

# Build the data (fetch from sources, normalise, aggregate)
# This is a standalone tool — run it once, then iterate on the site freely
npm run data:build

# Start the dev server
npm run dev
```

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start the Astro dev server at `localhost:4321` |
| `npm run build` | Build the production site to `dist/` |
| `npm run preview` | Preview the built site locally |
| `npm run data:build` | Fetch all sources, normalise, aggregate into `src/data/` |
| `npm run data:validate` | Validate all generated JSON against Zod schemas |

### Data build is decoupled from site build

`data:build` scrapes/downloads from vendor sources and aggregates into
`src/data/`. `astro build` only reads that JSON — it never triggers scraping.
This lets you iterate on the website freely without re-downloading data.

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

## Data sources

| Source | Type | Notes |
|---|---|---|
| Mozilla MFSA | JSON feed | Well-structured, good patch-timing data |
| Microsoft MSRC | CVRF API | Structured JSON, requires API key |
| Project Zero | Issue tracker API | Rich disclosure timeline metadata |
| NVD/CVE | REST API | Cross-vendor canonical source, requires `NVD_API_KEY` |
| Google Chrome | HTML scraping | Chrome Releases blog, patch dates vary |
| Apple | HTML scraping | Defensive parser with NVD fallback on failure |

## Adding a new data source

1. Create a parser at `scripts/pipeline/sources/<vendor>.ts` exporting
   `async function fetchRecords(): Promise<VulnerabilityRecord[]>`.
2. Register the source in `scripts/pipeline/index.ts`.
3. Add the source ID to the `SourceId` union in `scripts/pipeline/types.ts`.
4. Add the manufacturer to `src/lib/manufacturers.ts` with a display name and colour.
5. Run `npm run data:build` and `npm run data:validate` to verify.

## Licence

MIT — see [LICENSE](LICENSE).
