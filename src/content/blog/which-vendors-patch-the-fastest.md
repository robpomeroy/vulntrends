---
title: "Which Vendors Patch the Fastest?"
description: "Patching speed varies enormously between Microsoft, Apple, Mozilla, Cisco, Oracle and the rest. Here is what the data actually shows, and why the answer is more complicated than a leaderboard."
pubDate: 2026-08-03
tags: [patching, vulnerability-management, msrc, vendor-comparison, mttp]
---

# Which Vendors Patch the Fastest?

If you had to guess which major software vendor patches known vulnerabilities
the fastest, who would you name? Many security people if pressed, will suggest a
name. The trouble is that the actual data rarely produces a clean leaderboard.
The difference between a vendor that genuinely patches quickly and one that
merely *records* a patch date accurately is the difference between a useful
metric and a misleading one.

VulnTrends currently tracks ten of the largest software manufacturers: Mozilla,
Microsoft, Google (Chrome and Android), Apple, Oracle, Cisco, Samsung, Palo Alto
Networks, Fortinet and Adobe. Each ships security updates on its own cadence,
publishes its own metadata, and discloses (or doesn't) the dates that allow
patch lag to be measured at all. The question "who patches the fastest" has at
least three subtly different answers depending on which metric you use.

## Three different metrics, three different answers

The most familiar metric is **time to patch**: how long after a flaw is fixed
does the record show a patch date? On this measure, Mozilla is essentially
always at zero. The Mozilla Foundation Security Advisories feed reports explicit
`Reported` and `Fixed` timestamps for every CVE it touches, so the gap between
the two is exactly the development time, often measured in hours. Microsoft is
also fast on this metric, with the MSRC CVRF API using `RevisionHistory` dates
to recover each CVE's true first-disclosure date. Google Chrome is similar — the
Chrome Releases blog records the rollout date, typically days after an internal
fix.

The second metric is **discovery-to-patch**, which is what most "mean time to
patch" reports claim to measure. The trick is that *discovery* is rarely
visible. Most vendors publish a patch date but not a separate discovery date —
the CVEs only appear publicly when the patch ships. For those vendors, the only
honest patch-lag figure is a zero, which is not meaningful. VulnTrends'
patch-lag chart shows a "data confidence" badge for exactly this reason: a 0-day
median patch lag often means "missing discovery data", not "instant patching".
The data confidence filter is the single most important control on the chart.

The third metric is **disclosure-to-patch for known-exploited bugs**. This is
the one that matters in practice, because it is the window defenders actually
deal with. Independent trackers — CISA's Known Exploited Vulnerabilities
catalogue, Mandiant's exploitation telemetry, EPSS scores — give us a comparable
view across vendors of how long it takes, once a bug is publicly known to be
under attack, before a fix is published.

## What the data actually shows

A handful of broad patterns hold across the data, even after the methodology
caveats are applied.

**Browser-class vendors patch fastest.** Mozilla, Google Chrome and Microsoft
Edge ship browser updates on a continuous cycle, often multiple times per month,
and the gap between reporting and shipping is small. The vendor feeds that
explicitly tag discovery and fix dates are concentrated in this group. A browser
bug reported to one of these vendors today is likely to have a public fix within
a week.

**Mobile and integrated vendors look fast for different reasons.** Apple rarely
publishes a discovery date. It ships security updates frequently — sometimes
several in a week, often iOS, macOS, watchOS, tvOS and visionOS updates on the
same day — and its release notes routinely include fixes for actively-exploited
vulnerabilities that were not previously disclosed. The aggressive out-of-band
release cadence is one reason Apple has historically had a small public
vulnerability backlog. Microsoft bundles large batches on Patch Tuesday but does
out-of-band releases for actively-exploited issues between cycles. Apple does
not have a Patch Tuesday, and the difference is visible in the volume per
release: typical Apple releases cover tens or low hundreds of CVEs across all
platforms, against Microsoft's monthly 100-600.

**Enterprise software vendors occupy the slow end.** Oracle, Cisco, Samsung, and
— to a lesser extent — Adobe, lag further behind on every metric where data is
available. Their patch-lag distributions are wider, the absolute number of days
is larger, and the number of CVEs that go unpatched-for-months or quietly
disappear (because the affected version is end-of-life) is materially higher.
Enterprise software is harder to patch without breaking customer environments,
vendor PSIRT processes are slower than embedded browser-team release trains, and
a meaningful share of disclosed CVEs are in products that are no longer
supported.

**Specialised security vendors are a mixed bag.** Palo Alto Networks and
Fortinet are interesting case studies. Both have direct feeds in VulnTrends'
pipeline and publish explicit published-and-updated dates. Both have visibly
accelerated their release pace over the past two years — Palo Alto Networks' May
2026 release, for example, contained more than five times its usual patch
volume, and Fortinet has shipped a series of high-frequency PSIRT updates
addressing actively-exploited CVEs. The acceleration is broadly real and partly
attributable to AI-assisted discovery inside the vendors' own security teams,
but it does not necessarily mean each individual bug is fixed faster. Average
patch lag and total volume are different metrics.

## Why the methodology matters

A vendor that publishes a discovery date is, in a sense, double-reporting: they
are admitting both that they knew about the bug before it was public and that
they have a metric for when they knew. Both are useful for defenders, but
neither is uniformly welcomed inside vendor organisations. Mozilla has
consistently chosen transparency on this point. Apple has consistently chosen
the opposite posture, in
[the words of Apple's security release notes](https://support.apple.com/en-us/HT201222):

> Apple doesn't disclose, discuss, or confirm security issues until an
> investigation has occurred and patches or releases are generally available.

Each vendor makes a deliberate choice that affects how its data appears in any
comparison.

The same caveat applies to large vendors whose data is NVD-backed in VulnTrends
— Oracle, Samsung, and Google's broader Android coverage. For these vendors, the
chart shows what NVD reports as a discovery date, which is usually the
publication date of the CVE record. That is not the same as "when the bug was
actually discovered". The chart's "low-confidence manufacturers" filter (less
than 50% of records with both dates) is the visible guard against drawing
sweeping conclusions from sparse data.

A useful exercise is to look at the patch-lag chart with the data confidence
indicator set generously. Mozilla, Microsoft, and Google Chrome cluster near the
bottom of the chart with patch lags measured in days. The other vendors show
distributions that are both wider and shifted right. The numbers themselves are
unkind to read off the chart, and the methodology page is worth reading before
quoting any of them. But the rank order is reasonably robust and the spread is
significant.

## What this means in practice

**Don't trust an aggregated mean.** A "mean time to patch of 30 days" across a
vendor's portfolio is rarely the value relevant to a specific exploitable bug.
The relevant metric is:
*for this CVE, with this EPSS score, in this product, what is the patch ETA?*
For most vendors, the answer is more like "have you looked at the CISA KEV
catalogue and the vendor's recent security advisories?" than "look at the
chart".

**Treat the brand as a proxy, not a guarantee.** The vendor that patches its
browser quickly may not patch its cloud control plane, identity provider, or
collaboration tool at the same speed. Apple's iOS and Microsoft's Windows are
not the same products as their enterprise identity or developer toolchains. The
relevant patch cadence is the one for the product you actually depend on.

**Compensating controls outlast a slow patch.** For vendors with longer patch
lags, the practical response is the same one security teams have been giving for
years: segmentation, least-privilege access, virtual patching at the perimeter,
tight monitoring of the specific product at risk. The organisations that defend
slow-patch vendors best treat the patch ETA as a known uncertainty and design
around it.

**The defender's patch list is wider than the vendor list.** The interesting
question is becoming less "which vendor patches the fastest" and more "which
vendor's *defenders* can patch the fastest". A vendor that publishes a patch
but offers poor release notes, no KB article, no regression-test guidance and
no advisory metadata leaves even fast-patch work effectively undone. The
administrative cost of a patch often outweighs the development cost.

## The honest answer

If the question is "of the ten vendors on VulnTrends' dashboard, which ones most
reliably and quickly produce a public fix for a known vulnerability they have
been told about", the answer is Mozilla, Google Chrome and Microsoft. Their data
is the most complete and their patch cadences are the shortest.

If the question is "which vendor ships the most fixes against the most
actively-exploited vulnerabilities as quickly as possible", the answer is harder
to defend as a single name. Apple ships frequently and aggressively. Microsoft
ships predictably and at scale. The browser vendors turn around browser-class
issues in days. Each is a different kind of "fast".

If the question is "which vendor should I trust my security posture to, based on
patching speed", the answer is none of the above. The fastest patch in the world
is irrelevant if you cannot deploy it. The vendors that help defenders deploy
fast — clear advisories, automated detection, regression-tested fixes, broad
version coverage — are the ones that genuinely earn the patch-speed lead. The
VulnTrends patch-lag chart is a useful starting point. It is not a substitute
for knowing the vendor whose product is on your network.
