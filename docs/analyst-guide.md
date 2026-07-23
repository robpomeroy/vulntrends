# VulnTrends data analyst's guide

This document is for analysts (analyst-of-data, not security analyst — though
security researchers will also find it useful) who want to **understand**,
**trust**, or **improve** the data behind the VulnTrends dashboard.

The dashboard ships with built-in `[About this chart]` sections on each
chart page, so **start there** for a chart-by-chart explanation. This guide is
the deeper reference: how the dataset is structured, what each field means,
where the data comes from, and how to spot (and fix) data-quality issues.

---

## 1. Quick orientation

```
$ # what's in the dataset?
$ ls src/data/raw/                       # per-source raw extracts (one file per source)
adobe.json    all.json         apple.json    chrome.json  cisco.json
fortinet.json mozilla.json     msrc.json     nvd.json      osv.json
pan.json      projectzero.json
$ ls src/data/aggregated/                 # post-aggregation time-series for the dashboard
backlog-by-month.json     discovered-by-month.json    fixed-by-month.json
patch-lag-by-month.json   severity-mix-by-month.json
…and the corresponding *-by-year.json variants
manufacturers.json                          # canonical 10-vendor list with chart colours
```

| File | What it is |
|---|---|
| `src/data/raw/<source>.json` | One file per parser. Each is an array of `VulnerabilityRecord` objects. The MSRC file no longer contains Mariner records (they're filtered out at parse time — see §4). |
| `src/data/raw/all.json` | All sources concatenated, then **deduplicated** by CVE ID and merged. This is what the aggregator reads. |
| `src/data/aggregated/*.json` | Time-bucketed counts (per manufacturer, per bucket key like `2025-04`) that the dashboard renders. |
| `src/data/meta.json` | Pipeline metadata: when the run happened, source-level record counts, per-source duration, etc. |

### The pipeline in one paragraph

```bash
npm run data:build   # fetch all sources → src/data/raw/<source>.json → dedup → all.json
                     # → aggregate → src/data/aggregated/
npm run data:validate # Zod schema check on every JSON file (shape/type only)
npm run data:audit    # semantic check on all.json (plausibility, coverage, outliers)
npm run data:test     # unit tests for the dedup helpers and Mariner filter
```

---

## 2. The `VulnerabilityRecord` schema

Every record in `src/data/raw/*.json` matches this Zod schema
([`src/lib/schema.ts`](../../src/lib/schema.ts)):

```ts
interface VulnerabilityRecord {
  id: string;                  // CVE ID (CVE-YYYY-NNNN+), except for projectzero stubs
  cveIds: string[];            // all CVE IDs the record covers (usually one)
  source: 'mozilla' | 'msrc' | 'apple' | 'chrome' | 'pan' | 'fortinet'
         | 'adobe' | 'projectzero' | 'cisco' | 'osv' | 'nvd';
  manufacturer: string;        // canonical name, e.g. 'Microsoft' (not 'microsoft')
  title: string;               // human-readable title; for vendor records this is
                               //   the advisory headline
  discoveredDate?: string;     // ISO YYYY-MM-DD; the date the CVE first became public
  patchedDate?: string;        // ISO YYYY-MM-DD; the date a fix was released
  patchLagDays?: number;       // derived: patchedDate - discoveredDate
  cvss?: number;               // CVSS v3 base score (0.0-10.0)
  severity?: 'critical' | 'high' | 'medium' | 'low';  // derived from cvss
  rawUrl?: string;             // link to the original advisory
  provenance?: { source: string; fetchedAt: string };  // when & from where
}
```

### Field meanings in plain English

- **`id`**: usually a CVE ID. For records that cover multiple CVEs, this is
  the "primary" one and `cveIds` lists the rest.
- **`discoveredDate`**: the date the CVE first became publicly known. This
  is **not** the patch date. For Linux distros that publish patches but
  not disclosure dates, this can be the CVE-assignment date from NVD.
- **`patchedDate`**: the date a fix was released. `null` means no patch
  date was available from any source (common for NVD-only records).
- **`patchLagDays`**: derived. Some upstream manufacturers publish
  `patchedDate` but not `discoveredDate` — the dashboard shows the gap
  as the patch lag. A 0-day median usually means "missing discovery
  data", **not** "instant patching" — see §6 on data confidence.
- **`manufacturer`**: canonical name from [`src/lib/manufacturers.ts`](../../src/lib/manufacturers.ts).
  Aliases like "msrc", "windows", "google chrome", "microsoft corporation"
  all normalise to the same canonical name.

---

## 3. Data sources (live and NVD-backed)

| Source | Records (typical) | What it covers | Notes |
|---|---|---|---|
| **Mozilla MFSA** | ~1,100 | Firefox, Thunderbird, focus on Firefox's security advisories | Has explicit Reported/Fixed timestamps → real patch lag |
| **MSRC CVRF** | ~13,500 | Microsoft Windows / Office / Azure / etc. | Filters Mariner documents at the parser (see §4). Per-vuln `RevisionHistory` is the discovery proxy. |
| **Apple Support** | ~5,800 | macOS, iOS, iPadOS, Safari | Scrapes support.apple.com index; per-CVE detail is best-effort |
| **Chrome Releases blog** | ~1,500 | Chrome stable-channel security releases | Parses Blogger Atom feed; bypasses Google's ad-network HTML scraping |
| **Pan-OS JSON** | ~25 | Palo Alto Networks PAN-OS | Direct JSON feed |
| **Fortinet PSIRT** | ~700 | FortiOS, FortiProxy | Separate Published + Updated dates |
| **Adobe PSIRT** | ~12 | Adobe products (Acrobat, Reader, etc.) | HTML index + best-effort per-bulletin |
| **NVD/CVE** | ~33,000 | Cross-vendor coverage + per-vendor CPE queries | The "backbone" — fills gaps where no direct source exists |
| **Project Zero** | 0 (stub) | Was bugs.chromium.org/p/project-zero; endpoint retired | Coverage comes via NVD's `google` CPE |
| **Cisco / OSV** | 0 (stubs) | Cisco (OAuth required) / OSV (opt-in via env var) | Both stub-only; coverage comes via NVD |

The full list lives in [`scripts/pipeline/index.ts`](../../scripts/pipeline/index.ts).

---

## 4. Why MSRC was producing misleading spikes (and what we fixed)

This is the most important section for data-trust. **Skip it and you'll
waste time debugging a non-existent "AI-driven discovery" trend.**

### The artefact

MSRC publishes a separate CVRF document per Linux distribution advisory
called **Mariner** (Microsoft's Linux distro). Each Mariner document
references ~30 upstream Linux CVE IDs (kernel, glibc, OpenSSL, …).
The Mariner document is separate from the regular Microsoft Security
Update monthly document.

The CVRF document has a single `<vuln:RevisionHistory>` entry per CVE,
which is the catalog re-import date. Before this fix, the parser read
the earliest revision as `discoveredDate`, so **every CVE in a Mariner
document got stamped with the re-import date** (e.g. `2025-09-03`). The
dedup then preferred MSRC's date over NVD's `published` date because
MSRC outranked NVD in source precedence, so the bad dates shipped into
the aggregated data.

This produced a monthly spike of 1,000–2,000 Microsoft records dated
September 2025 and similar future months — most of them Linux upstream
CVEs that had nothing to do with Microsoft.

### What the fix does

Two layered defences ([`scripts/pipeline/sources/msrc.ts`](../../scripts/pipeline/sources/msrc.ts)):

1. **Document-level filter.** Any `DocumentTitle === "Mariner Release
   Notes"` document is skipped before we even fetch the body. As of
   2026-07-22 there are 64 Mariner documents; the pipeline logs
   `Microsoft MSRC: skipped 64 Mariner document(s)` so you can see the
   skip count.
2. **Per-vulnerability filter.** Within non-Mariner documents, any
   `<vuln:Note Title="Mariner">`-tagged vulnerability is dropped.
   Defence-in-depth for the rare case of Mariner records co-mingled
   with Microsoft records in a non-Mariner document.

The dedup also got stronger ([`scripts/pipeline/normalise.ts`](../../scripts/pipeline/normalise.ts)):

- New helper `dateMatchesCveYear()` rejects a `discoveredDate` that's
  more than 1 year from the CVE-year of any CVE in the record's
  `cveIds` list.
- The merge picks the earliest **sane** candidate from primary vs.
  secondary. If both are bad, the record is dropped (returns `null`).
- The "vendor used patch as discovery" legacy tie-breaker still works
  for Mozilla etc. (where `discoveredDate === patchedDate` is
  legitimate), but is gated on the NVD candidate passing the sanity
  check.

### How to verify the fix

```bash
# 1. Look for the Mariner skip in the pipeline log
npm run data:build 2>&1 | grep "skipped.*Mariner"
#  → "Microsoft MSRC: skipped 64 Mariner document(s) (1999-Sep, 2000-Feb, 2000-Jan, 2000-Oct, 2001-May…)"

# 2. Run the audit — it now has a catalogue-re-publication check
npm run data:audit 2>&1 | grep -A2 "catalog-republication"
#  → should show "no catalog-re-publication residuals"

# 3. Inspect the September 2025 spike directly
$ # (PowerShell)
$data = Get-Content src/data/raw/all.json -Raw | ConvertFrom-Json
$sep = $data | Where-Object { $_.discoveredDate -like "2025-09-*" }
$sep | Group-Object { if ($_.id -match 'CVE-(\d{4})-') { $Matches[1] } else { '?' } }
# Pre-fix: 977 records for CVE-2010 through CVE-2024
# Post-fix: only ~800 records, all CVE-2025-* (legitimate Microsoft activity)
```

If A6 reports residuals for MSRC, the parser filter has regressed — see
[`scripts/pipeline/test-msrc-mariner.mjs`](../../scripts/pipeline/test-msrc-mariner.mjs).

---

## 5. The dedup merge — pick the right date

[`scripts/pipeline/normalise.ts`](../../scripts/pipeline/normalise.ts)
exposes the dedup logic. When two sources report the same CVE, the merge
selects `discoveredDate` by this rule:

1. Apply `dateMatchesCveYear()` to both candidates. A candidate passes if
   its year is within `DATE_SANITY_MAX_YEARS` (default **1**) of any
   CVE-year in the record's `cveIds` list.
2. Pick the **earliest** surviving candidate. Tied on first character of
   the ISO date string.
3. **Legacy tie-breaker**: if the chosen date equals the vendor's
   `patchedDate` (Mozilla's behaviour), promote NVD's date instead.
4. If **all** candidates fail, drop the record entirely (the merge
   returns `null`). The audit surfaces what got dropped.

The "earliest wins" rule is what catches future MSRC re-imports even if
the Mariner filter fails: a `2026-07-12` stamp on `CVE-2010-4756` is
rejected outright, and NVD's `2010-12-15` (which survives the check
because the year matches) wins.

### See the test fixtures

[`scripts/pipeline/test-dedup-date.mjs`](../../scripts/pipeline/test-dedup-date.mjs)
covers 20 cases:

| Scenario | Expected result |
|---|---|
| Same-year dates, both sane | earliest wins |
| Vendor date off by >1 year from CVE-year | vendor candidate rejected, NVD chosen |
| Both candidates off by >1 year | record dropped (`null`) |
| Mozilla `discoveredDate === patchedDate` | NVD date promoted (legacy behaviour) |
| Multi-CVE record with one valid CVE-year | date accepted |
| Both records same source, same id | first wins |
| Vendor missing `patchedDate`, NVD has one | NVD's patchedDate fills in |

If you change the dedup merge, update these tests in the same PR.

---

## 6. Data confidence — what "0-day patch lag" really means

`patchLagDays` is **derived** from `discoveredDate` and `patchedDate`. For
many vendors the actual real-world gap is unknowable because:

- **Mozilla** is the only vendor with explicit Reported/Fixed timestamps.
  The dashboard's "high confidence" data is the Mozilla data.
- **Apple, Microsoft, Chrome** all publish **patch dates** but the
  disclosure date is implied (the CVE-ID assignment date from NVD). The
  patch-lag chart uses the NVD `published` date as the discovery proxy,
  which is **often weeks late** under responsible-disclosure embargoes.
- **NVD-only records** (Oracle, Samsung, Cisco) have `discoveredDate`
  from NVD but **no `patchedDate`** because NVD doesn't track patch
  timelines.

### Reading the patch-lag chart

- A **low median** + **high data confidence** (Mozilla-style): vendors
  are patching fast. Trust it.
- A **0-day median** + **low data confidence** (NVD-only vendors): the
  0-day mean the vendor told us about the *patch*, not about the
  vulnerability. Use the "high" toggle to filter to vendors with
  above-threshold patch-date coverage before drawing conclusions.

The patch-lag card has a confidence badge showing the percentage of
records that have both dates, and a toggle to hide low-confidence
manufacturers.

---

## 7. Aggregation choices

[`scripts/aggregate.ts`](../../scripts/aggregate.ts) groups records by
`(date bucket, manufacturer)` and emits per-month and per-year time
series.

- **`discovered`**: count of records where `discoveredDate` falls in the
  bucket. **This is the dataset the September-2025-spike bug most
  affected.**
- **`fixed`**: count of records where `patchedDate` falls in the bucket
  and `patchedDate` is set. Vendors with sparse patch data (Oracle,
  Samsung, Cisco) appear under-represented here by design.
- **`patchLag`**: per-bucket median and p90 of `patchLagDays` per
  manufacturer. Buckets with fewer than 5 records are excluded to
  avoid noise.
- **`backlog`**: per-bucket open vulnerabilities = `discovered` −
  `fixed`, applied cumulatively across the timeline. Records older than
  `BACKLOG_STALE_YEARS` (default **5**) with no `patchedDate` are
  assumed patched silently — this is the "stale horizon" guard.
  Without it, low-coverage vendors would accumulate an ever-growing
  backlog. Tweak via env var.
- **`severityMix`**: count of records bucketed by CVSS-derived severity
  (`critical ≥ 9.0`, `high ≥ 7.0`, `medium ≥ 4.0`, `low`).

### Coverage eras

The dashboard defaults to **2013-present** (`FULL_COVERAGE_START_YEAR`
in [`src/lib/store.ts`](../../src/lib/store.ts)). Pre-2013 data is
opportunistic: many vendors had no public advisory programmes before
2013, NVD's CPE coverage was immature, and Project Zero/Cisco didn't
exist.

### Stale horizon

A vulnerability with no `patchedDate` is "open" until `BACKLOG_STALE_YEARS`
have passed, at which point the aggregator assumes it was patched
silently and drops it from the backlog. Set the env var
`BACKLOG_STALE_YEARS=N` to change the value (operator-only; the
aggregator warns when more than 5% of records hit the stale path).

---

## 8. The audit script — what each check catches

[`scripts/data-audit.ts`](../../scripts/data-audit.ts) runs after
`data:validate` and flags semantic issues. Hard errors exit non-zero;
warnings are advisory.

| ID | Severity | What it catches |
|---|---|---|
| **A1** | warn | Source `currentYear` count > 5× trailing-3-year median. Catches bulk re-publication regressions like the 2025-Sep spike. |
| **A2** | warn | `|CVEYear − discoveredYear| > 5`. Coarse net for upstream pipeline artefacts. |
| **A3** | error | Records dated more than 7 days in the future (timezone shift, "today" fallback). |
| **A6** | error | Catalog-re-publication residual: a record has a `discoveredDate` in the last 18 months but a CVE-year ≥ 2 years before. Catches cases where the dedup missed something. |
| **E2** | warn | Per-manufacturer patch-date coverage < 10%. |
| **E5-dup** | error | Duplicate record IDs after dedup. |

If A6 fires, look at `scripts/data-audit.ts:bySrc` in the warning — the
counts per source tell you where to investigate first.

### Known residual: cross-CNA MSRC records

A6 still surfaces **6 MSRC records** whose titles start with another
CNA's name (e.g. `"HackerOne: CVE-2023-32002"`, `"MITRE CVE-2016-9535"`,
`"Red Hat, Inc. CVE-2023-2804"`). These are MSRC catalog entries for
CVEs that were originally published by a non-Microsoft CVE Numbering
Authority — MSRC hosts them in their advisory catalog but the
underlying vulnerability isn't a Microsoft product.

The fix is a title-prefix filter in `scripts/pipeline/sources/msrc.ts`:
drop records whose title starts with a known CNA name (`MITRE`, `HackerOne`,
`Red Hat`, `AMD`, `Intel`, `Kaspersky`, etc.). This is **not yet wired**
because it risks false positives (a Windows component named e.g.
"AMD's amdk8 driver" would get dropped) — the analyst investigating
the trigger needs to balance that tradeoff. The trigger counts in the
`bySrc` map tell you how many records are affected; if it's a single-
digit number per month, audit them by hand; if it grows, add the filter.

### Known residual: NVD with delayed `published` dates

A6 also typically surfaces **~20 NVD records** with `published` dates
in the last 18 months for CVEs whose CVE-year is ≥ 2 years earlier.
This is the cached NVD dataset's behaviour: the dataset was originally
harvested in 2024 and the local copy's `published` field sometimes
records when NVD was touched last, not the original CVE-publication
date. Re-running `npm run data:build` with an `NVD_API_KEY` env var
will refetch NVD from scratch and most of these residuals will disappear.

The 1-year dedup sanity check rejects genuine cases (e.g. a 1999 CVE
that wasn't indexed by NVD until 2003), but the A6 audit is more
forgiving (18 months) so it won't flag those.


---

## 9. Common data questions

### "Why is X so high this month?"

1. Check `npm run data:audit` — A1 may be triggering. That's the most
   common signal of an upstream re-publication.
2. Open `src/data/raw/all.json` and filter by month/contractor.
3. If MSRC: look at the `discoveredDate` distribution. A 1-day
   concentration of `CVE-2024-*` or older is the Mariner re-import
   artefact (which is now filtered out — if you see it, the filter
   regressed).

### "Why is X so low?"

1. Is `BACKLOG_STALE_YEARS` set higher than the gap? Operators may
   have bumped it for a specific investigation. The aggregator
   logs a warning if stale records exceed 5% of total.
2. Did a vendor's data source fail? Check
   `src/data/meta.json` → `sourceCounts`.

### "Where can I add a new vendor?"

Add an entry to [`src/lib/manufacturers.ts`](../../src/lib/manufacturers.ts)
with the canonical name + chart colour, then write a parser in
[`scripts/pipeline/sources/`](../../scripts/pipeline/sources/) and
register it in the `SOURCES` array of
[`scripts/pipeline/index.ts`](../../scripts/pipeline/index.ts). Follow
the msrc.ts pattern: parse → build a per-vuln record → call
`buildRecord()` from [`scripts/pipeline/normalise.ts`](../../scripts/pipeline/normalise.js).

### "How do I add a new aggregation bucket?"

The aggregations are time-bucketed by `(date key, manufacturer)`. To
add a new chart axis, edit `scripts/aggregate.ts` to emit a new
`<axis>-by-<granularity>.json`. See the existing pattern in the
`backlog` aggregator for the cumulative metric.

---

## 10. Testing your changes

```bash
npm run data:test     # 35 tests covering dedup logic and Mariner filter
npm run data:validate # Zod schema check on every JSON
npm run data:audit    # semantic sanity check (warnings vs errors)
npm run data:build    # full pipeline (slow with no API keys; uses cached NVD)
```

The dedup tests in `scripts/pipeline/test-dedup-date.mjs` are the
regression net for any future change to `mergeRecords()`. Update them
first when changing date semantics, then verify the new behaviour
matches your intent against `src/data/raw/all.json`.

---

## Appendix: file map

```
src/
├── lib/
│   ├── schema.ts         # Zod schema for VulnerabilityRecord (source of truth)
│   ├── store.ts          # dashboardStore: shared Svelte store
│   ├── manufacturers.ts  # canonical 10-vendor list with chart colours
│   ├── load.ts           # build-time data loader (manifest, JSON parsing)
│   └── d3/
│       ├── brush.ts      # D3 brush + zoom controls
│       ├── zoom.ts       # zoom math (computeZoomedRange — pure)
│       └── theme.ts      # chart colours / fonts
├── data/
│   ├── raw/              # per-source raw (one file per parser)
│   │   └── all.json      # deduped + merged
│   ├── aggregated/       # time-bucketed counts for the dashboard
│   └── meta.json         # pipeline run metadata
└── content/
    └── blog/             # Astro content collection (blog posts)

scripts/
├── pipeline/
│   ├── index.ts          # orchestrator (fetch → dedup → write all.json)
│   ├── normalise.ts      # normalization helpers + dedup merge logic
│   ├── sources/          # one parser per source
│   ├── test-dedup-date.mjs   # dedup regression tests (20 cases)
│   └── test-msrc-mariner.mjs # Mariner filter tests (15 cases)
├── aggregate.ts          # raw → time-bucketed JSON
├── validate.ts           # Zod schema check
├── data-audit.ts         # semantic sanity check
└── archive-snapshot.ts   # tier-2 archive (local staging; replicated
                          #  to ARCHIVE_RSYNC_TARGET via publish.ts)
```

---

Last updated: 2026-07-23. Archive replication was switched from
"committed to the repo" to "rsynced to ARCHIVE_RSYNC_TARGET" after it
became clear that production (Synology) has read-only Git access and
could never push the snapshot blobs from the daily publish.
