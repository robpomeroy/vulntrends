# Publishing the website and refreshing data

This guide explains how to publish the VulnTrends website and refresh the
vulnerability data. Both processes are automated via GitHub Actions, but
this document also covers manual execution for local development and
troubleshooting.

## Prerequisites

- Node.js 22 or later
- An `NVD_API_KEY` repository secret (for the NVD/CVE API rate limits)
- GitHub Pages enabled in the repository settings (source: GitHub Actions)

## How publishing works

VulnTrends uses a **decoupled build** architecture:

1. **Data refresh** — fetches vulnerability data from vendor sources,
   normalises it, and commits the resulting JSON to `src/data/`.
2. **Site build** — reads the committed JSON and builds the static site.
3. **Deploy** — publishes the built site to GitHub Pages.

These steps are never chained automatically in local development. The data
refresh and site build are separate commands so you can iterate on the
website without re-downloading data each time.

## Automated: GitHub Actions

### Data refresh workflow

File: `.github/workflows/refresh-data.yml`

This workflow runs on a daily schedule (06:00 UTC) and can also be
triggered manually from the GitHub Actions tab.

**What it does:**

1. Checks out the repository.
2. Installs dependencies with `npm ci`.
3. Runs `npm run data:build` (with `NVD_API_KEY` from secrets).
4. Runs `npm run data:validate` to verify data integrity.
5. Commits any changed JSON files in `src/data/` and pushes.

**Triggering manually:**

1. Go to the repository on GitHub.
2. Click the **Actions** tab.
3. Select **Refresh vulnerability data** in the left sidebar.
4. Click **Run workflow** and confirm.

### Deploy workflow

File: `.github/workflows/deploy.yml`

This workflow runs on every push to `main` and automatically after the
data refresh workflow completes successfully.

**What it does:**

1. Checks out the repository (including any freshly committed data).
2. Installs dependencies with `npm ci`.
3. Runs `npm run build` (Astro build — reads JSON only, never scrapes).
4. Uploads the `dist/` directory as a Pages artifact.
5. Deploys to GitHub Pages.

> **Note:** The deploy workflow never runs `data:build`. It only consumes
> the JSON that has already been committed to the repository.

## Manual: Local development

### Refreshing data locally

```sh
# Set your NVD API key (optional but recommended for faster fetches)
$env:NVD_API_KEY = "your-api-key-here"

# Fetch all sources, normalise, and aggregate
npm run data:build

# Validate the generated data
npm run data:validate
```

On Linux/macOS, set the environment variable with:

```sh
export NVD_API_KEY="your-api-key-here"
npm run data:build
```

The data build can take 10+ minutes without an NVD API key due to rate
limiting (approximately one request per 6 seconds).

### Using sample data for fast iteration

If you just want to work on the website without waiting for the full
data pipeline, use the sample data generator:

```sh
npm run data:sample
```

This creates 2,000+ synthetic but realistic vulnerability records and
runs the aggregation step. You can then start the dev server and iterate
freely:

```sh
npm run dev
```

### Building and previewing locally

```sh
# Build the production site
npm run build

# Preview the built site
npm run preview
```

The preview server serves the site at `http://localhost:4321/vulntrends/`.

## Committing data changes

If you run `data:build` locally and want to update the deployed site:

1. Run `npm run data:build` and `npm run data:validate`.
2. Review the changes with `git diff src/data/`.
3. Commit the data:

   ```sh
   git add src/data/
   git commit -m "chore(data): refresh vulnerability data"
   git push
   ```

4. The push to `main` will trigger the deploy workflow automatically.

## Troubleshooting

### Data refresh fails in CI

- Check that the `NVD_API_KEY` secret is set in the repository settings
  (Settings → Secrets and variables → Actions).
- Review the workflow logs in the Actions tab for which source failed.
- Individual source failures are non-fatal — the pipeline writes an empty
  array for any source that errors and continues with the remaining sources.

### Apple parser returns no data

Apple's advisory pages are HTML and may change structure. The parser is
defensive: if scraping fails, it returns an empty array and the pipeline
relies on NVD data for Apple-related CVEs as a fallback. Check the parser
in `scripts/pipeline/sources/apple.ts` if this becomes a persistent issue.

### Deploy fails

- Ensure GitHub Pages is configured to deploy from **GitHub Actions**
  (Settings → Pages → Build and deployment → Source: GitHub Actions).
- Check that the `dist/` directory was generated successfully in the
  build step logs.

### Dev server timeout

The Astro dev server may take longer than 30 seconds to start on first
run due to Vite's dependency optimisation. If it times out, try running
`npm run build` first to warm the Vite cache, then `npm run dev`.

## Summary of commands

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server at `localhost:4321` |
| `npm run build` | Build the production site to `dist/` |
| `npm run preview` | Preview the built site locally |
| `npm run data:build` | Fetch all sources, normalise, aggregate into `src/data/` |
| `npm run data:validate` | Validate all generated JSON against Zod schemas |
| `npm run data:sample` | Generate synthetic data for fast website iteration |
