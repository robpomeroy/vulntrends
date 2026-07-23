---
title: Vulnerabilities fixed
description: How many vulnerabilities each manufacturer patched in each time period.
---

The "Vulnerabilities fixed" chart counts the number of vulnerabilities
whose patch (or vendor advisory) was released in each time bucket.
Stacking shows the per-manufacturer contribution; the area total shows
the cross-vendor patching throughput.

## What this chart shows

For each month (or year), the chart reports how many vulnerabilities
were patched for that manufacturer. A vulnerability is counted in the
bucket of its **`patchedDate`** — the date the patch or advisory became
public, not the date it was deployed by an end user.

## How it's calculated

The aggregator groups records by:

1. **`patchedDate`** — set during normalisation when the source exposes
   a "fixed" or "patch release" timestamp.
2. **`manufacturer`** — canonical vendor name.
3. **Granularity bucket** — `YYYY-MM` or `YYYY`.

A record with no `patchedDate` is **never** counted in this chart.

## Data sources

The chart is dominated by sources that report a patch release:

- Mozilla (`MFSA` advisories)
- Apple (`HT20xxxx` advisories)
- Microsoft (`MSRC` CVRF)
- Chrome (Atom feed of stable-channel releases)
- Adobe, Fortinet, Palo Alto (vendor PSIRTs)

NVD records do **not** carry a `patchedDate` field, so NVD-only
records never appear in this chart. Where a vendor advisory supplies
a patch date, deduplication carries that date into the merged record.

## Limitations

- **Patching rate ≠ remediation rate.** The chart records when a patch
  was *released*, not when users installed it. Real-world patching
  lag at the consumer/enterprise level is much larger.
- **Backports and silent fixes.** Some vendors (notably Apple and
  Microsoft) silently patch vulnerabilities by bundling them into
  larger releases. Only vulnerabilities with a publicly dated patch
  are visible here.
- **Manufacturers with sparse patch data.** Samsung and Oracle have
  historically published fewer dated patch advisories, which makes
  their bars look smaller than their actual patching throughput.

## How to interpret

Cross-vendor comparisons of "patches shipped per month" should be
treated with caution. Different vendors bundle fixes differently:
some advisories cover a single CVE, others cover hundreds. The raw
count favours vendors with granular advisories (Mozilla, Project Zero)
over those with monthly rollups (Microsoft Patch Tuesday).

A more useful cross-vendor comparison is the *Patch lag* chart,
which normalises for advisory granularity by measuring the time
between discovery and patch on a per-CVE basis.
