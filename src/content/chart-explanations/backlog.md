---
title: Vulnerability backlog
description: The number of vulnerabilities that have been discovered but not yet patched, tracked over time.
---

The "Vulnerability backlog" chart tracks the running count of
**open vulnerabilities** at each point in time — those that have
been discovered but for which no patch date is known.

## What this chart shows

At each month (or year), the chart shows how many vulnerabilities
were open for that manufacturer. A vulnerability opens when it's
discovered and closes (drops off the backlog) when a patch is
released. The stacked total represents the cumulative cross-vendor
patching debt.

## How it's calculated

For each record with a `discoveredDate`:

1. **Open the vulnerability** at `discoveredDate` (add 1).
2. If `patchedDate` is present, **close it** at `patchedDate`
   (subtract 1).
3. Walk the timeline, maintaining a running count per manufacturer.

Each month/year emits one row per manufacturer where the running
count is positive.

## Critical caveat: missing patch data

**The backlog chart is sensitive to patch-data coverage.** If a
manufacturer's records don't carry `patchedDate` (e.g. their
advisories don't publish per-CVE patch dates, or the only source
is NVD which has no patch dates), the vulnerability is counted as
**still open** forever — even when it was patched years ago.

This produces a misleading backlog inflation for:

- Manufacturers with advisory programmes that don't expose
  per-CVE fix dates
- Manufacturers whose data is sourced primarily through NVD
  (which has no patch dates by design)

The aggregator applies a 5-year stale horizon: a vulnerability with
no recorded patch date and a discovery older than 5 years is assumed
to have been patched silently and dropped from the backlog. Without
this horizon, a manufacturer with sparse patch data would appear to
accumulate an ever-growing open backlog.

The data-audit script (`npm run data:audit`) flags manufacturers
with < 10% patch-date coverage. If you're comparing backlogs
across vendors, look at confidence first.

## Data sources

The chart builds on the same sources as the discovered and fixed
charts. A manufacturer's backlog accuracy is a direct function of
how completely their patch data is captured.

## Limitations

- **No information about patch availability.** A vulnerability is
  "closed" only when the source records a `patchedDate`. A patch
  shipped silently (with no dated advisory) keeps the
  vulnerability on the books.
- **No prioritisation.** All open vulnerabilities count equally,
  regardless of severity. A high-CVSS bug counts the same as a
  low-severity information disclosure. For severity-weighted
  backlog, a future enhancement could multiply each open record by
  its CVSS score.
- **No deduplication with upstream packages.** A vulnerability in
  a shared library (e.g. OpenSSL) is counted against each
  downstream vendor that ships it. The vendor's "backlog" is
  really their *affected-product* backlog, not their *engineering
  effort to patch* backlog.

## How to interpret

A growing backlog for a manufacturer over multiple consecutive
years is a strong indicator of under-investment in security
patches. A flatline can be healthy (stable patching throughput)
or unhealthy (stagnation against a growing number of new
disclosures — compare with the "discovered" chart).

Sudden drops in a manufacturer's backlog curve usually reflect a new patch-data
source becoming available, not a sudden wave of simultaneous fixes — for
example, when a vendor starts publishing historical patch dates. Always check
`src/data/meta.json` (especially `sourceCounts` and `sources`) to spot this kind
of data-source change before drawing conclusions.
