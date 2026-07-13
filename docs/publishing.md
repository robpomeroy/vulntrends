# Publishing the website and refreshing data

This guide explains how to publish the VulnTrends website and refresh the
vulnerability data. Both processes are automated via GitHub Actions, but
this document also covers manual execution for local development and
troubleshooting.

## Prerequisites

- Node.js 24 or later (the `engines` field in `package.json` enforces this)
- For the data refresh: an `NVD_API_KEY` secret. Stored in `.env`
  locally, and as a repository secret on GitHub. An `MSRC_API_KEY`
  is also supported if you have one.
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
3. Runs `npm run data:build` (with `NVD_API_KEY` and `MSRC_API_KEY`
   from the repository's encrypted secrets, passed via the workflow's
   `env:` block).
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

The data build script (`npm run data:build`) automatically picks up
secrets from a local `.env` file via Node's `--env-file-if-exists`
flag. For a one-time setup:

```sh
# Copy the template and fill in your secrets
cp .env.example .env
# Edit .env with your actual NVD_API_KEY (and MSRC_API_KEY if you have one)
```

The `.env` file is gitignored — it stays on your machine only. On
GitHub Actions, the same variables come from the repository's
encrypted secrets (see "Required secrets" below) and the env file
is simply not present.

If you'd rather not use a file, you can still set the variables
inline the old way:

```sh
# PowerShell
$env:NVD_API_KEY = "your-api-key-here"
npm run data:build

# bash / zsh
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

`src/data/` is gitignored — only `.github/workflows/refresh-data.yml`
is allowed to update the live data on GitHub. **You should not
commit data changes from your local clone** — they will be
overwritten by the next daily workflow run, and your commits will
create merge conflicts with the bot's automated commits.

If you want to update the data out of band (e.g. the workflow is
failing and you need to push a fix):

1. Run `npm run data:build` and `npm run data:validate` locally.
2. Review the changes with `git diff src/data/`.
3. Force-add the data files (the gitignore would otherwise block them):

   ```sh
   git add -f src/data/
   git commit -m "chore(data): refresh vulnerability data"
   git push
   ```

4. The push to `main` will trigger the deploy workflow automatically.

## Required secrets

| Variable | Where it's read | Purpose |
|---|---|---|
| `NVD_API_KEY` | `scripts/pipeline/sources/nvd.ts` | Bumps the NVD/CVE rate limit from 1 req/6s to ~1 req/0.5s. Without it the build takes 10+ minutes. |
| `MSRC_API_KEY` | `scripts/pipeline/sources/msrc.ts` | Optional. The MSRC CVRF API is publicly accessible (Microsoft dropped the registration requirement in Feb 2021); without a key the source works but is rate-limited to ~10 req/min, so the full data build can take ~10 hours. With a key the limit is higher. To request a key, email `msrcapi@microsoft.com` with a brief description of what you're building — there is no automated self-serve sign-up. |

**On GitHub:** add both as repository secrets at
*Settings → Secrets and variables → Actions* (use the exact variable
names above). The `refresh-data.yml` workflow passes them to the
build step via the `env:` block.

**Locally:** drop them in a `.env` file in the repo root, e.g.:

```ini
# .env  (gitignored)
NVD_API_KEY=your-key-here
MSRC_API_KEY=your-key-here
```

The `data:build` script passes `--env-file-if-exists=.env` to `tsx`,
so the file is loaded automatically when present and silently ignored
when absent (e.g. if you set the variables inline in your shell).

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
