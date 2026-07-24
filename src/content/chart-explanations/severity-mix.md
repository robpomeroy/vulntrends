---
title: Severity mix
description: How the mix of CVSS severity buckets (critical / high / medium / low) has shifted over time, across all manufacturers.
---

The "Severity mix" chart tracks how the proportion of vulnerabilities
in each CVSS severity bucket (critical / high / medium / low) has
shifted over time. It uses the same vulnerability records as the other
charts; the difference is the *axis of analysis* — instead of grouping
by manufacturer, it groups by severity.

## What this chart shows

For each month (or year), the chart reports how many CVEs were
disclosed in each severity bucket. The four bands stack to the total
disclosure count; their relative heights show the *mix* of severity
at that point in time.

## How it's calculated

The aggregator groups records by:

1. **`severity`** — derived from CVSS using the standard v3.x
   qualitative scale (critical ≥ 9.0, high ≥ 7.0, medium ≥ 4.0,
   low < 4.0). Records with no CVSS score and no vendor-supplied
   severity rating are excluded.
2. **`discoveredDate`** — same field as the "discovered" chart.
3. **Granularity bucket** — `YYYY-MM` for monthly, `YYYY` for yearly.

## Data sources

All sources contribute to this chart, weighted by how many of their
records carry CVSS data:

- **NVD** is the dominant source — virtually every NVD record has a
  CVSS v3 score.
- **Vendor advisories** vary: Mozilla and Apple publish CVSS for
  nearly every advisory; Microsoft MSRC and some smaller vendors
  don't always include a CVSS, so their records are excluded.
- **OSV** parses CVSS vectors and contributes a CVSS-derived
  severity for many records.

## Limitations

- **Vendor-vs-NVD scoring divergence.** Different organisations
  score the same CVE differently. A Mozilla "high" may correspond
  to an NVD "critical" because Mozilla is more conservative. The
  chart reflects whatever CVSS record survives dedup, which is
  usually the vendor's score.
- **CVSS v2 vs v3.** NVD records from before 2016 sometimes still
  carry a CVSS v2 score, which we map to the same severity buckets
  via the v2 → v3 qualitative scale mapping. This is a coarse
  approximation.
- **CVE with no score.** Some CVEs ship without a CVSS rating at
  all (e.g. disputed CVEs, withdrawn CVEs, or "informational" entries).
  These are invisible to this chart. The data-audit script
  (`npm run data:audit`) can surface their proportion.

## How to interpret

A growing proportion of *critical* or *high* CVEs over time can
indicate one or more of:

- The software under measurement is becoming more attractive to
  attackers (more valuable targets → more severe exploitation
  attempts → more severe CVEs).
- Disclosure practices have shifted (e.g. CVSS scoring is now
  applied where previously it was omitted, inflating the average).
- A small number of high-severity vulnerabilities is dominating
  the year (e.g. a major RCE class). Compare with the absolute
  count on the "discovered" chart to disambiguate.

A growing proportion of *low* / *medium* CVEs may reflect shifts in reporting,
scoring practices, or research focus. Pair this chart with the absolute
"discovered" count to distinguish a changing mix from changes in overall volume.
