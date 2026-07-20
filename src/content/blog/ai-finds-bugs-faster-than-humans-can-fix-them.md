---
title: "AI Finds Bugs Faster Than Humans Can Fix Them"
description: "Anthropic's Claude Mythos Preview is producing tens of thousands of high-severity findings. The bottleneck in cybersecurity has shifted from discovery to remediation."
pubDate: 2026-07-20
tags: [vulnerability-management, ai-security, open-source, cve, patching]
heroImage: '/images/blog/ai-finds-bugs-faster-than-humans-can-fix-them.jpg'
heroImageAlt: 'AI finds bugs faster than humans can fix them. The bottleneck in cybersecurity has shifted from discovery to remediation.'
---

# AI Finds Bugs Faster Than Humans Can Fix Them

What does it cost to find a serious software vulnerability today? Until very
recently, the answer was "a great deal of skilled human time, paid for by
someone with patience". In April 2026, Anthropic's
[Project Glasswing](https://www.anthropic.com/glasswing) put that assumption to
the test. Within a month, partners reported more than ten thousand high- or
critical-severity vulnerabilities across their own code. Anthropic scanned a
further thousand open-source projects and surfaced roughly 6,200 more. Of those,
1,752 went to independent security firms for assessment; 90.6% were confirmed as
valid. By late May, 1,596 findings had been disclosed to maintainers across 281
projects. Ninety-seven had been patched.

That last figure is the one that matters.

## Discovery is no longer the bottleneck

For most of the history of commercial vulnerability management, the bottleneck
was clear: not enough skilled reviewers to find the bugs. Bug bounties, internal
red teams, penetration tests and source code auditors are all attempts to scale
a fundamentally human activity, and they are expensive, slow and unevenly
distributed. That assumption no longer holds.

The Mythos Preview model scored 83.1% on the CyberGym vulnerability-detection
benchmark, against 66.6% for Anthropic's own Claude Opus 4.6. On exploit
development — the more dangerous half of the work — it scored 72.4%, a figure
that is effectively zero for the current generation of widely-available models.
These are not marginal improvements. They represent a step change in what a
single piece of software can do in a week.

The results in production match the benchmarks. Cloudflare, one of the Glasswing
launch partners, found 2,000 bugs (400 rated high or critical) across its
critical-path systems and reported a false-positive rate it considers better
than human testers. Mozilla found and fixed 271 vulnerabilities in Firefox 150,
more than ten times what it found in Firefox 148 using Opus 4.6. Palo Alto
Networks' latest release contained more than five times its usual number of
patches; Microsoft has said its Patch Tuesday numbers will continue trending
larger for some time.

To put it bluntly, an experienced human reviewer might find a few dozen bugs in
a sizeable codebase in a quarter. A frontier model, given the same task, will
find thousands. Discovery has become cheap.

## Patching has not become cheaper

Software does not get more secure just because someone knows where the holes
are. A real fix needs someone to understand the root cause, design a change that
does not regress the existing behaviour, test it across the configurations
downstream consumers actually run, write the advisory, coordinate the disclosure
window and ship the update. None of that scales by throwing tokens at it.

When Anthropic disclosed 1,596 validated vulnerabilities to maintainers, 97 had
been patched — a remediation rate of about 6%. The Cloud Security Alliance's
[analysis](https://cloudsecurityalliance.org/artifacts/project-glasswing-ai-discovery-outpaces-open-source-patching-capacity)
of the same dataset is worth quoting: "the primary security bottleneck has
shifted from vulnerability *discovery* to vulnerability *remediation*". The
standard 90-day coordinated-disclosure window, designed for human-speed
discovery, looks generous next to the question "can the maintainer of this small
library, who has a day job, write a correct fix in that time?".

Several maintainers have asked Anthropic to slow its disclosure rate because
they cannot keep up. The average time to patch a high- or critical-severity bug
disclosed through Glasswing is now two weeks; that figure is itself impressive,
and it is still too slow.

## The exploitation window has collapsed

There was a time when a disclosed vulnerability sat in a window of relative
safety while defenders caught up. In 2018 the median time from public disclosure
to weaponised exploit was 771 days. That figure is now in single-digit hours.
Independent analysis suggests 28.3% of CVEs are exploited within 24 hours of
disclosure. Mandiant has reported that exploitation is, on average, happening
before patches are available.

That is the reality a 6% remediation rate is operating in. The window in which a
disclosed but unpatched bug is exclusively a defender problem has effectively
closed. The disclosure of a vulnerability is now best understood as the *start*
of an attack campaign, not the end of a defensive one.

There is a second-order effect that compounds the problem. The volume of
AI-generated vulnerability reports has become so high that some projects have
given up trying to triage them publicly. The curl project shut down its public
bug bounty after AI-generated submissions overwhelmed its reviewers; FFmpeg
maintainers have publicly characterised the flood as "CVE slop". High-quality
disclosures from coordinated programmes such as Glasswing arrive in the same
queue as thousands of low-quality auto-generated reports. We are at risk of
degrading the very mechanism that allowed coordinated disclosure to work.

## The metadata layer is buckling under the volume

CVE submissions to the US National Vulnerability Database rose 263% between 2020
and 2025. The NVD has acknowledged it can no longer enrich every submission and
now reserves its analytical bandwidth for the highest-risk items. That matters
because a great deal of downstream tooling — vulnerability prioritisation, asset
management dashboards, ticketing systems — depends on NVD's CVSS scores and CWE
classifications to triage. As more entries arrive unscored, the signal quality
of automated triage tools degrades exactly when defenders most need it.

For anyone who has built a vulnerability management programme around CVSS
thresholds and NVD feeds, this is a quiet warning: your input data is changing
shape, and the toolchain built on top of it may be making increasingly confident
decisions on increasingly unreliable inputs.

## What this looks like on the ground

Among the open-source findings Mythos Preview produced was a remote code
execution flaw in wolfSSL, a cryptographic library used by billions of devices.
The model identified the vulnerability *and* constructed a working exploit that
would let an attacker forge certificates — letting them stand up a fake banking
site that looks genuine to the end user. That is now patched as
[CVE-2026-5194](https://nvd.nist.gov/vuln/detail/CVE-2026-5194). The same model
found a 17-year-old remote code execution bug in FreeBSD's NFS implementation
([CVE-2026-4747](https://www.penligent.ai/hackinglabs/cve-2026-4747-freebsd-rpcsec%5Fgss-remote-code-execution/))
and a 27-year-old flaw in OpenBSD.

These are not findings from obscure projects. wolfSSL is a serious,
security-focused library; FreeBSD and OpenBSD are operating systems with
extensive review histories. Decades of human review had missed what a
sufficiently capable model could find in a single run. If the friendly version
of this technology can do that, the unfriendly version will eventually be able
to as well.

## What defenders should do about it

Anthropic's write-up of Glasswing is direct about what this means for defenders. The advice is not new. It is, however, more important than it has ever been.

- **Treat Glasswing-era disclosures as emergency changes, not scheduled maintenance.**
  The 97 confirmed remediations from the first batch are high-confidence fixes
  to real, severe bugs. Waiting for the next patch window is a poor bet given
  current exploitation timelines.
- **Audit dependencies against the 281 disclosed projects**, direct and
  transitive. Prioritise internet-facing components and those handling
  authentication, cryptography or network parsing. Build a software bill of
  materials if you do not already have one.
- **Stop relying on NVD scores as your primary triage signal.** GitHub Security
  Advisories, vendor advisories and direct maintainer relationships are
  increasingly the more current source. Treat unscored CVEs as unassessed, not
  low-risk.
- **For what you cannot patch, deploy compensating controls** — segmentation,
  least privilege, comprehensive logging. The CSA's Zero Trust guidance is the
  obvious architectural reference.
- **Shorten the testing and deployment cycle for fixes.** The bottleneck is
  rarely patch development; it is the regression-testing pass that follows.
  AI-assisted patch validation is one of the more credible near-term defensive
  uses of this technology.
- **Build a direct relationship with the maintainers of your most critical dependencies.**
  GitHub's private security advisory mechanism is a reasonable start. The goal
  is to learn about the bug before it is public.

Open-source software is critical infrastructure maintained largely by volunteers
or under-resourced teams. The structural problem Glasswing has exposed — that
the world's most widely deployed software depends on largely uncompensated
labour — predates AI. AI has merely made the gap impossible to ignore. Sustained
investment in maintainer capacity, through projects such as OpenSSF's
Alpha-Omega, through direct corporate sponsorship and through government funding
on the same footing as physical infrastructure, is now a defensive necessity
rather than a charitable cause.

## What comes next

Mythos Preview is the first of its kind, not the last. Anthropic has stated that
Mythos-class models will become more broadly available as safeguards catch up,
and other AI labs are working on comparable capabilities. The headline number —
97 out of 1,596 disclosed vulnerabilities patched, roughly 6% — will improve. It
has to. But it is the actual operating ratio of the open-source security
ecosystem today: for every twenty serious vulnerabilities a frontier model
finds, fewer than two are patched.

These models will be used for defence regardless — they are already in
production at Cloudflare, Mozilla, Palo Alto Networks, Microsoft and Oracle. The
question is whether the wider ecosystem adapts to the new cadence quickly enough
to remain useful. If the patching ratio does not climb, the disclosure of a
serious bug becomes an attacker's announcement rather than a defender's warning,
and the things we have built on top of open-source software become a great deal
less trustworthy than we currently assume.

---

## Social media posts

### Twitter/X
Project Glasswing: 1,596 vulns disclosed to open-source maintainers, 97 patched. A 6% fix rate. The exploitation window is now hours.

### LinkedIn
Project Glasswing exposed a structural problem in cybersecurity: discovery is no longer the bottleneck. Of 1,596 high-severity findings disclosed across 281 open-source projects, 97 were patched. The exploitation window is now hours.

### BlueSky
AI can now find more bugs in a month than defenders can patch in a year. Project Glasswing: 10,000+ findings, 1,596 disclosed, 97 fixed. The discovery-to-remediation gap is the new bottleneck.

### Mastodon
When 90.6% of AI-discovered vulnerabilities validate as real, and 6% get patched, what we have is not a vulnerability problem but a remediation-capacity problem. The NVD is at breaking point; coordinated disclosure was designed for human-speed discovery. The model has changed.