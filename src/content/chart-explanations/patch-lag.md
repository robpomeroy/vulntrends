---
title: Time between discovery and patch
description: How long it takes each manufacturer to patch a vulnerability after it has been disclosed.
---

The "Time between discovery and patch" chart measures, for each
vulnerability, the elapsed time between the **`discoveredDate`**
(when the vulnerability first became known) and the **`patchedDate`**
(when a fix was released). The chart reports the **median** (typical
case) and **p90** (worst-case, 90th percentile) per month/manufacturer.

## What this chart shows

Patch lag is the canonical measure of how quickly a manufacturer
responds once a vulnerability is known. Lower is better. The
median line tracks typical performance; the p90 band surfaces the
long tail of slow fixes.

## How it's calculated

For each record with both `discoveredDate` and `patchedDate`:

1. **`patchLagDays = patchedDate - discoveredDate`**
2. Group by month (or year) and manufacturer.
3. Compute the **median** and **p90** of `patchLagDays` within each group.

Records where `discoveredDate == patchedDate` are excluded —
most vendor advisories stamp both fields with the same date, so a
0-day lag from those is a proxy artefact (we're using the patch date
as a stand-in for the discovery date), not a measured turnaround.
Excluding these keeps the median/p90 honest about the records that
genuinely show a pre-patch discovery.

## Data confidence

The "data confidence" indicator on this chart is critical: it shows
what fraction of records contributed a real (non-zero, non-proxy)
patch lag to the calculation. A 0-day median from a manufacturer
with 5% confidence is **not the same** as a 0-day median from one
with 90% confidence — the former usually means "we don't have
independent discovery dates", the latter is genuinely fast patching.

Common reasons for low confidence:

- **NVD-only manufacturers.** NVD records have no `patchedDate`,
  so a manufacturer with no advisory feed shows 0% confidence.
- **Bulk-disclosure advisories.** Some vendors (notably OpenSSL
  and various Linux distributions) publish a single quarterly
  advisory that fixes dozens of CVEs without per-CVE dates.

The "Hide low-confidence manufacturers" toggle filters out
manufacturers below 50% confidence, which is useful when you want
a head-to-head view of vendors that actually publish discovery
timing.

## Data sources

Patch lag data comes predominantly from these sources:

- Mozilla (MFSA — publishes both Reported and Fixed timestamps)
- Microsoft MSRC (per-CVE `RevisionHistory` dates for discovery)
- Project Zero (issue-tracker Reported/Fixed timestamps)
- Apple (advisory publication date as proxy)

NVD `lastModified` could theoretically be used as a patch proxy,
but we leave it out because the timing is too noisy (NVD also
updates records for non-fix reasons).

## Limitations

- **Project Zero's 90-day deadline.** Project Zero publicly
  discloses vulnerabilities 90 days after reporting them, regardless
  of patch status. This can inflate the perceived patch lag for
  vendors that miss Project Zero's deadline, even when the vendor
  had good reasons (e.g. the patch requires downstream coordination).
- **Disclosure embargoes.** Many vendors privately discover
  vulnerabilities through bug-bounty reports and develop patches
  before public disclosure. The chart measures this private gap as
  "patch lag of zero or near-zero" — which is the right number, but
  isn't a sign of overnight patching.

## How to interpret

A rising patch lag trend is a strong negative signal for a
manufacturer. It often indicates:

- Increasing product surface area (more code to patch)
- Resource constraints in the security team
- A change in disclosure practice (more internal discoveries going
  public without a coinciding patch)

A falling patch lag is generally positive, but check the
confidence indicator first: a manufacturer whose confidence rose
along with patch lag reduction may just be publishing more
discovery dates, not actually patching faster.
