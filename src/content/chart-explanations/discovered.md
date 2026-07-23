---
title: Vulnerabilities discovered
description: How many new vulnerabilities each manufacturer disclosed, broken down by month or year.
---

The "Vulnerabilities discovered" chart counts the number of distinct
vulnerabilities whose disclosure date falls in each time bucket.
Disclosure is measured as the date the vulnerability first became
publicly known — either via a vendor advisory, a CVE assignment by
MITRE, or an entry in the National Vulnerability Database.

## What this chart shows

For each month (or year, when you toggle granularity), the stacked
area reports how many vulnerabilities were first disclosed for that
manufacturer. Stacking lets you see both the total volume and the
relative contribution of each vendor over time.

## How it's calculated

The aggregator groups records from `src/data/raw/all.json` by:

1. **`discoveredDate`** — the per-record field set during normalisation.
2. **`manufacturer`** — the canonical name (e.g. "Microsoft", "Apple").
3. **Granularity bucket** — `YYYY-MM` for monthly, `YYYY` for yearly.

A record is counted in **the bucket of its `discoveredDate`**, not the
bucket of when we discovered it (e.g. when NVD added a CVE to its
database). For advisory records, `discoveredDate` is the original
advisory date, not the date our pipeline ingested it.

## Data sources

The chart counts records from any source whose parser populates
`discoveredDate` — the full set is documented in
[`src/lib/manufacturers.ts`](../../../../scripts/pipeline/types.ts).
Where multiple sources report the same CVE (identical `id`),
deduplication prefers vendor advisories over NVD, since advisories
typically have more accurate timing.

## Limitations

- **NVD `published` vs true discovery.** For CVEs that reach NVD, the
  `published` field is what we use as a discovery proxy. Real
  disclosure often occurs earlier — sometimes by weeks, under
  responsible-disclosure embargoes. The chart is therefore a lower
  bound on discovery volume.
- **Pre-2013 coverage is incomplete.** Several manufacturers (notably
  Samsung and Palo Alto) had no public advisory programmes before
  2013. The default dashboard view restricts to 2013 onwards and
  exposes a "Full history" option with an explicit caveat.
- **MSRC.** Microsoft's CVRF API re-publishes the full historical
  catalog under a single `CurrentReleaseDate`. The parser uses
  per-vulnerability `RevisionHistory` dates to recover the true
  initial disclosure date for each CVE.

## How to interpret

A rising line for one manufacturer can mean three things:

1. The manufacturer's product surface area is growing.
2. The manufacturer is investing more in vulnerability research
   (e.g. paid bug bounties).
3. Their products are attracting more adversarial attention.

A falling line does **not** necessarily mean products are getting
safer — it can also mean disclosure practices have changed, or that
a manufacturer has stopped reporting vulnerabilities. Always pair
this chart with the "Vulnerabilities fixed" chart to read the full
picture.
