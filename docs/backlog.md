# VulnTrends backlog

A working list of known data-quality issues and planned fixes.
Items here are intentionally **not blocking** the daily publish — they
document the current state of the dataset and the plan to improve it
on a slower cadence than the daily deploy.

## 1. A6 audit residuals — fix at source (option 3)

**Status**: live in production; tolerance of 50 is in place; full
fix deferred.

**What this is**: the `A6` check in `npm run data:audit` flags records
whose `discoveredDate` is in the last 18 months but whose CVE-year is
at least 2 years earlier. This is the signature of a catalog
re-publication: an upstream source re-stamps old CVEs with a recent
date (the MSRC Mariner re-import bug from July 2026 was the original
case). The check was hardened with a tolerance of 50 so the known
~30 residuals don't block every deploy, but a regression that pushes
the count above 50 will still hard-fail.

**The 30 known residuals** (current production baseline, as of
2026-07-24) fall into three categories:

### 1.1 MSRC cross-CNA re-imports (6 records)

Microsoft's CVRF catalog includes advisories *authored by other CNAs*
that Microsoft has agreed to publish. The CVE-year is old (e.g. 2023)
but the catalog re-publication date is recent. The Mariner filter
doesn't catch these (they're not Mariner documents) and the dedup's
`dateMatchesCveYear` sanity check lets them through because the vendor
date is within ±1 year of *some* plausible interpretation.

| CVE | Source | cveYear | discDate | Title prefix |
|---|---|---|---|---|
| CVE-2023-32002 | msrc | 2023 | 2025-02-11 | `HackerOne: …` |
| CVE-2016-9535  | msrc | 2016 | 2025-10-14 | `MITRE CVE-2016-9535: …` |
| CVE-2023-20585 | msrc | 2023 | 2026-04-14 | `AMD: …` |
| CVE-2023-2804  | msrc | 2023 | 2026-02-10 | `Red Hat, Inc. CVE-2023-2804: …` |
| CVE-2023-31096 | msrc | 2023 | 2026-01-13 | `MITRE: …` |
| CVE-2024-55414 | msrc | 2024 | 2026-01-13 | (no prefix) |

### 1.2 NVD delayed-publishes (21 records)

NVD legitimately publishes old CVEs years after assignment. The
`published` field on the NVD record genuinely is the recent date
(NVD is just slow to ingest some CVEs, especially those from
non-CNA sources). The A6 check is over-broad here: it flags any
"recent date + old CVE-year" as suspicious, but NVD's delayed-publish
pattern is legitimate.

Sample:
- `CVE-2019-15706` (Fortinet, published 2025-03-17)
- `CVE-2020-3432` (Cisco, published 2025-02-12)
- `CVE-2020-9695` (Adobe, published 2026-06-23)

### 1.3 Apple/Adobe late-patch advisories (3 records)

Apple and Adobe sometimes issue advisories for old CVEs when they
finally patch them on older OS or product versions.

| CVE | Source | cveYear | discDate |
|---|---|---|---|
| CVE-2023-41974 | apple | 2023 | 2026-03-11 |
| CVE-2023-27043 | apple | 2023 | 2025-03-31 |
| CVE-2023-25690 | adobe | 2023 | 2026-07-14 |

### 1.4 Plan to fix at source

The goal is to bring the A6 count from 30 down to ~9 by addressing
each category at its source rather than via the audit's tolerance.

**Step 1: MSRC cross-CNA filter** (fixes 6 of 30)

Add a title-prefix filter to the MSRC parser, analogous to the existing
Mariner document filter. Skip records whose title matches any of:

```
^HackerOne: 
^MITRE CVE-
^MITRE: 
^Red Hat, Inc. 
^AMD: 
^Kunai: 
^ZDI-Can-
```

These are all known CNA prefixes that MSRC publishes on behalf of
other CNAs. The filter belongs in `scripts/pipeline/sources/msrc.ts`
next to `isMarinerDocument` / `isMarinerVulnerability`.

**Step 2: A6 source-specific refinement** (fixes 21 of remaining 24)

NVD delayed-publishes are *legitimate*, not a parser bug. The A6
check should exclude NVD-sourced records from the residual count, or
treat them as a separate `A6-nvd-delayed-publish` category at lower
severity. Two options:

- **(a)** Add a source allow-list to the A6 check:
  `if (r.source === 'nvd') continue;` — simplest, but loses the
  ability to catch a future NVD bulk re-stamp.
- **(b)** Keep NVD in the A6 check but emit a separate, lower-
  severity issue for NVD delayed-publishes. Preserves the
  regression-detection capability but adds code complexity.

Option (a) is recommended unless we have evidence of NVD bulk
re-stamps as a real risk.

**Step 3: Apple/Adobe late-patch investigation** (remaining ~3)

These records are genuine late-patch advisories. No fix is needed —
they're correctly captured. The residual count just needs to be
documented as "expected baseline = 9" (6 cross-CNA filtered + 3
late-patch).

**Step 4: Lower the A6 tolerance** (after steps 1-3)

Once the residual count is at the new baseline of ~9, lower
`A6_RESIDUAL_TOLERANCE` to 15 (giving a 6-record safety margin).
Any regression that adds 6+ new residuals will then block
publication, which is the right sensitivity for a stable baseline.

### 1.5 Acceptance criteria

- A6 residual count ≤ 9 on a fresh `npm run data:build`
- All 6 MSRC cross-CNA residuals absent from `src/data/raw/all.json`
- A6 tolerance lowered to 15 in `scripts/data-audit.ts`
- New regression tests in `scripts/pipeline/test-msrc-mariner.mjs`
  (or a new test file) covering the CNA-prefix filter
- Analyst guide updated to reflect the new baseline
- This backlog entry moved to a "resolved" section or removed

### 1.6 Estimated effort

- Step 1: ~30 minutes (parser change + 3-5 test cases)
- Step 2: ~15 minutes (one-line A6 change)
- Step 3: ~10 minutes (docs only)
- Step 4: ~5 minutes (constant + docs)

Total: ~1 hour, plus the pipeline re-run and validation (~10 minutes).

---

## How to use this document

New known data-quality issues should be added as top-level numbered
sections. Each section should include:

- **What it is** — a one-paragraph summary
- **Current state** — the known residual count, broken down by
  category if applicable
- **Why it's not blocking** — the rationale for living with the
  issue (tolerance threshold, documented false-positive class, etc.)
- **Plan to fix** — concrete steps with estimated effort
- **Acceptance criteria** — what "done" looks like

The daily publish must not block on any item in this document.
