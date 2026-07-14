# Publishing the website and refreshing data

This guide explains how to publish the VulnTrends website and refresh the
vulnerability data. The data refresh and site build should run via a scheduled
task; the built site is then rsynced to a web host.

## Prerequisites

- Node.js 22 or later (the `engines` field in `package.json` enforces this)
- An `NVD_API_KEY` for the NVD/CVE API (request at
  <https://nvd.nist.gov/developers/request-an-api-key>)
- An `MSRC_API_KEY` is optional (email `msrcapi@microsoft.com` to request one)
- SSH access to the web host with a key-based login (no passphrase)
- rsync available on the machine running the publish script

## First-time setup on each platform

`node_modules/` is **gitignored** because some dependencies (notably `esbuild`)
ship a platform-specific native binary. If you develop on Windows and run
`npm run publish` on Linux (or vice versa), the wrong-platform binary will
be loaded and `data:build` (or any step that imports esbuild) will fail
with `You installed esbuild for another platform than the one you're
currently using.`

**Run `npm ci` on each platform once** (Windows, Linux/WSL, macOS) to
install the correct native binaries:

```sh
# First time on a new platform:
cd /path/to/vulntrends
npm ci
```

After that, every script in `package.json` that uses `tsx` is
prefixed with `node scripts/check-platform.mjs &&` — a plain-Node
(no tsx, no esbuild) pre-flight. This is required because
`npm run publish` invokes `tsx scripts/publish.ts`, and `tsx`
itself depends on esbuild: if the wrong-platform esbuild is in
`node_modules`, esbuild throws an uncaught error the moment Node
loads `publish.ts`, so any check that lives *inside* `publish.ts`
never gets a chance to run.

`check-platform.mjs` scans `node_modules/@esbuild/` for the
current platform's variant. If only wrong-platform binaries are
present, it runs `npm ci` automatically and tells you to re-run.
For other known optional-native packages (`better-sqlite3`,
`sharp`), it prints a warning only — auto-fixing varies (rebuild
vs. reinstall) and is left to you.

## How publishing works

VulnTrends uses a **decoupled build** architecture:

1. **Data refresh** — fetches vulnerability data from vendor sources, normalises
   it, and writes JSON to `src/data/`.
2. **Site build** — reads the JSON and builds the static site to `dist/`.
3. **Deploy** — rsyncs `dist/` to the web host.

The `npm run publish` script chains all three steps. Each step prints its
progress to stdout; on failure the script exits non-zero to be picked up by the
task scheduler/cron.

## Automated: Scheduled task

### Setting up the scheduled task

Set up a scheduled task or cron job to run the script. Under Linux the task
action will be, e.g.:

```bash
cd /path/to/vulntrends && npm run publish >> /path/to/vulntrends/logs/publish.log 2>&1
```

Set the web host connection details in `.env` (see below).

### What the publish script does

`scripts/publish.ts` runs four steps in sequence:

1. `npm run data:build` — fetch all sources, normalise, aggregate
2. `npm run data:validate` — Zod schema check
3. `npm run build` — Astro static build → `dist/`
4. `rsync dist/ → web host` — incremental upload via SSH

The rsync invocation uses the following flags:

- `-avz` — archive mode (preserves permissions/timestamps), verbose, compressed.
- `--delete` — remove files on the remote that no longer exist locally
  (keeps the remote in lock-step with `dist/`).
- `--exclude='@eaDir/'` — Synology DSM creates `@eaDir` directories
  (extended-attribute indexes for FileStation / the media indexer)
  inside every directory it touches. They contain thumbnails and
  metadata, not content, and would otherwise be synced to
  production. Add more excludes to the `excludes` array in
  `scripts/publish.ts` as needed.
- `--chmod='D755,F644'` — force directories to `0755` and files to
  `0644` on the destination. Without this, rsync's `-a` (archive)
  would preserve whatever permissions the local `dist/` files
  happen to have — and those depend on whoever ran
  `npm run build` (your user on the NAS, often root or
  Administrator elsewhere), which is rarely what the web host
  wants. The web host needs a consistent 0755/0644 split so the
  PHP/Apache user can read files and traverse directories without
  giving the world write access.
- `-e '<ssh command>'` — the SSH command is passed as a single
  argument so the port, identity file, and `StrictHostKeyChecking`
  options all reach rsync intact. The whole SSH string is wrapped
  in single quotes in the log output for clarity; the actual
  `execFileSync` call passes it as one argv element so no
  shell-level escaping is involved.

If any step fails, the script prints the error to stderr and exits non-zero. The
Synology Task Scheduler will email you the full output.

### Staging

To publish to the staging site instead of production:

```sh
npm run publish:staging
```

This uses `DEPLOY_STAGING_PATH` instead of `DEPLOY_PROD_PATH`.

### Dry run

To test the full pipeline (data refresh + validate + build) without
actually deploying:

```sh
npm run publish:dry-run
```

Or staging dry-run:

```sh
npm run publish:staging:dry-run
```

## Manual: Local development

### Refreshing data locally

The data build script (`npm run data:build`) automatically picks up secrets from
a local `.env` file via Node's `--env-file-if-exists` flag. For a one-time
setup:

```sh
# Copy the template and fill in your secrets
cp .env.example .env
# Edit .env with your actual NVD_API_KEY (and MSRC_API_KEY if you have one)
```

The `.env` file is gitignored — it stays on your machine only.

If you'd rather not use a file, you can still set the variables inline:

```sh
# PowerShell
$env:NVD_API_KEY = "your-api-key-here"
npm run data:build

# bash / zsh
export NVD_API_KEY="your-api-key-here"
npm run data:build
```

The data build can take 20+ minutes without an NVD API key due to rate limiting
(approximately one request per 6 seconds).

### Using sample data for fast iteration

If you just want to work on the website without waiting for the full data
pipeline, use the sample data generator:

```sh
npm run data:sample
```

This creates 2,000+ synthetic vulnerability records and runs the aggregation
step. You can then start the dev server and iterate freely:

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

The preview server serves the site at `http://localhost:4321/`.

## Required .env variables

### Data pipeline keys

| Variable | Where it's read | Purpose |
|---|---|---|
| `NVD_API_KEY` | `scripts/pipeline/sources/nvd.ts` | Bumps the NVD/CVE rate limit from 1 req/6s to ~1 req/0.5s. Without it the build takes 10+ minutes. |
| `MSRC_API_KEY` | `scripts/pipeline/sources/msrc.ts` | Optional. The MSRC CVRF API is publicly accessible (Microsoft dropped the registration requirement in Feb 2021); without a key the source works but is rate-limited to ~10 req/min. To request a key, email `msrcapi@microsoft.com`. |

### Web host deployment

| Variable | Purpose |
|---|---|
| `DEPLOY_HOST` | Hostname or IP of the web host |
| `DEPLOY_PORT` | Custom SSH port (default 22) |
| `DEPLOY_USER` | SSH user account on the web host |
| `DEPLOY_KEY` | Path to the SSH private key (no passphrase) |
| `DEPLOY_PROD_PATH` | Web root path on the host for the production site |
| `DEPLOY_STAGING_PATH` | Web root path on the host for the staging site |

All variables are read from `.env` (gitignored). Copy `.env.example`
to `.env` and fill in the values.

## Troubleshooting

### Data refresh fails

- Check that `NVD_API_KEY` is set in `.env`. Without it, the NVD source will be
  rate-limited to 1 req/6s and the build may time out.
- `MSRC_API_KEY` is optional. Without it the MSRC source still works, just
  slowly.
- Individual source failures are non-fatal — the pipeline writes an empty array
  for any source that errors and continues with the remaining sources.

### Apple parser returns no data

Apple's advisory pages are HTML and may change structure. The parser is
defensive: if scraping fails, it returns an empty array and the pipeline relies
on NVD data for Apple-related CVEs as a fallback. Check the parser in
`scripts/pipeline/sources/apple.ts` if this becomes a persistent issue.

### rsync fails

- Verify the SSH key has no passphrase (`ssh-keygen -p -f /path/to/key` to
  remove it if needed).
- Test SSH manually:
  `ssh -p $DEPLOY_PORT -i $DEPLOY_KEY $DEPLOY_USER@$DEPLOY_HOST`
- Check that the target path exists on the web host.
- Ensure `rsync` is installed on the machine running the publish script.

### Dev server timeout

The Astro dev server may take longer than 30 seconds to start on first run due
to Vite's dependency optimisation. If it times out, try running `npm run build`
first to warm the Vite cache, then `npm run dev`.

## Summary of commands

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server at `localhost:4321` |
| `npm run build` | Build the production site to `dist/` |
| `npm run preview` | Preview the built site locally |
| `npm run data:build` | Fetch all sources, normalise, aggregate into `src/data/` |
| `npm run data:validate` | Validate all generated JSON against Zod schemas |
| `npm run data:sample` | Generate synthetic data for fast website iteration |
| `npm run publish` | Full pipeline: data refresh + validate + build + rsync to production |
| `npm run publish:staging` | Same, but deploy to staging path |
| `npm run publish:dry-run` | Full pipeline minus rsync (test without deploying) |
| `npm run publish:staging:dry-run` | Staging dry-run |
