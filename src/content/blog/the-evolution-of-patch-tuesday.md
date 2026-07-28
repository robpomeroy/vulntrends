---
title: "The Evolution of Patch Tuesday"
description: "Microsoft's monthly patch cycle was designed for human-speed security work. Twenty-three years in, it is buckling under machine-speed discovery."
pubDate: 2026-07-28
tags: [patch-tuesday, microsoft, vulnerability-management, ai-security, msrc]
---

# The Evolution of Patch Tuesday

In July 2026,
[Microsoft answered a question](https://msrc.microsoft.com/update-guide/releaseNote/2026-Jul)
that used to be rhetorical: how many vulnerabilities can one company responsibly
disclose on a single day? The answer was 622 unique CVEs fixed in one release —
the largest monthly update in the history of the Patch Tuesday programme. The
release also republished 461 Chromium CVEs and contained three zero-days, two of
them already under active exploitation. Researchers from Nightwing called it a
"pivotal moment" for the industry. Whether we are entering a continuous-patching
era, or watching the old one creak, is the question this piece tries to answer.

## Why Patch Tuesday existed in the first place

Microsoft formalised Patch Tuesday in October 2003, in the immediate aftermath
of the Blaster worm. Accumulating fixes over a month and dispatching them on the
second Tuesday at 10am Pacific gave administrators a predictable rhythm to plan
around. Predictability was an operations improvement. It also, almost as a side
effect, gave attackers a predictable date for reverse-engineering freshly
released patches. The day after release was soon nicknamed "Exploit Wednesday".

For most of the intervening two decades, that compromise held. Monthly releases
settled into the low double-digits of CVEs per month, occasionally spiking into
the seventies or low hundreds. Administrators learned to plan reboots, change
windows and emergency change boards around the second Tuesday. The disciplined
shops had the monthly process down to a rehearsal: scan, test, stage, deploy,
report. The people doing that work were the same people every month, and the
systems were largely the same too.

That assumption has not aged well.

## The numbers are no longer monthly — they are tidal

VulnTrends has been tracking how the volume of monthly disclosures has shifted
over the past decade. The trajectory is striking. Microsoft's annual disclosure
total set its previous record at 1,245 CVEs in 2020. Through May 2026 alone, the
company had patched more than 500 — putting 2026 on track to surpass that record
by July's end, and the year is only half over. The May 2026 release, by
contrast, looked almost restful: 137 CVEs, no actively-exploited zero-days, the
first such "no zero-day" release in nearly two years.

Then came July.

The 14 July release contained 622 unique Microsoft CVEs — exceeding any previous
Patch Tuesday by a wide margin and roughly four to five times a typical
mid-2010s monthly release. 422 of the fixes touch Windows itself. Office and
Office 2016 together account for 164. The release also republished 461
non-Microsoft Chromium CVEs. Of the 26 vulnerabilities with a CVSS base score
above 9.0, 13 carry a score of 9.8 — a density of near-maximum-severity flaws
that would have been extraordinary on an annual scale in any prior decade.

Two of July's zero-days landed on CISA's Known Exploited Vulnerabilities
catalogue within hours of disclosure. Federal agencies were given until
mid-to-late July to patch them. The implication for everyone else is familiar by
now: if you were not applying the release within a working day, you were already
behind.

## Why now? The AI explanation

In May, Microsoft's vice-president of engineering Tom Gallagher
[warned publicly](https://www.microsoft.com/en-us/msrc/blog/2026/05/a-note-on-patch-tuesday):

> This month's release sits on the larger side of a hotpatch month, and we
> expect releases to continue trending larger for some time... Advanced AI
> models are part of the discovery picture and help to accelerate it. They
> enable us to reason about code paths and configurations at a speed and
> consistency that would not be possible through manual review alone.

The vendor that invented Patch Tuesday is, on the record, saying the cycle is no
longer a cycle in the old sense: discoveries arrive continuously, and the
once-a-month bundling is becoming less a discipline and more a logistical
necessity. The fixes are still batched; they just happen to be very large
batches.

The external corroboration is sharper. Anthropic's Claude Mythos Preview was
tested against 14 Microsoft-evaluated vulnerabilities classed as "Exploitation
Less Likely" or "Exploitation Unlikely". It produced proof-of-concept exploits
for 13 of them. The implication is that the prior assumption — that Microsoft
had already triaged out the low-risk items — no longer holds when an attacker
has access to frontier AI capability (or a well-crafted harness).

## The end of the cycle, or just bigger cycles?

Some commentators have read the July release as the death of Patch Tuesday. The
Nightwing research team framed it that way, in a statement reported by
[Dark Reading](https://www.darkreading.com/vulnerabilities-threats/records-broken-patch-tuesday-raises-triage-stakes):

> Today, July 14, 2026, marks a pivotal moment in our industry. We are
> officially moving past the traditional 'Patch Tuesday' approach and entering
> an era of continuous, high-volume security updates.

The framing is appealing but not quite right. What is changing is the cadence of
discoveries, not Microsoft's release schedule. The batched release remains
useful: it gives the operations team a single deadline, a single change window,
a single round of testing. The size of the batch changes the shape of that work —
a 622-item release does not permit the kind of per-item pre-production testing
that a 30-item release did — but it does not eliminate it.

AI-assisted code analysis has moved from productivity tool to force multiplier.
Microsoft's own security engineers are using it; so are attackers. The pipeline
of vulnerabilities that lands on Patch Tuesday is now generated by systems that
operate non-stop, in every timezone, with no weekend and no holidays. The
monthly batch is downstream of a firehose.

Microsoft has been quietly preparing for this. Hotpatching — applying security
updates to a running Windows Server Azure Edition VM without restarting — is now
[generally available](https://learn.microsoft.com/en-us/azure/automanage/automanage-hotpatch).
It reduces a 622-item restart cycle to a 622-item live-patch cycle. For
organisations that have moved workloads to Azure, the practical implication is
large; for everyone else, the traditional reboot-and-go cycle is still with us.

## What defenders do about it

The veteran watchers are quietly unanimous on the response, even as the volume
disagrees with them. Jack Bicer of Action1 argues the volume itself is not the
primary challenge — it is the ability to triage, prioritise and deploy at speed.
Satnam Narang of Tenable makes the same point more sharply
([Dark Reading](https://www.darkreading.com/vulnerabilities-threats/records-broken-patch-tuesday-raises-triage-stakes)):

> CVSS is a good foundation, but it's just a number. Not every CVSS 9.8 is
> urgent, and not every CVSS below 8.0 should be ignored. Context matters. This
> is one of the core principles of proactive exposure management.

Mayuresh Dani of Qualys recommends layering [EPSS](https://www.first.org/epss/),
the [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)
catalogue and NIST's Likely Exploited Vulnerabilities model, and adopting a
tiered patching SLA: KEV-listed CVEs and EPSS>0.5 within 24 to 36 hours, then
internet-facing high-privilege infrastructure, then everything else.

In practice, that means an end to the old notion of "Patch Tuesday" as a
scheduled maintenance event. The schedule remains useful, but actual patching
has to happen continuously against a tiered plan. Microsoft's own guidance
increasingly reads that way: treat the monthly release as the floor, not the
ceiling, for patching effort.

A complementary point is worth making. Patch Tuesday originally assumed a world
in which the operating system and a handful of related products were the bulk of
what needed patching. Today the matrix covers AI services, cloud control planes,
identity systems, collaboration platforms and developer tools. The May release
contained seven CVEs in Copilot and Azure AI Foundry — a category that did not
exist in the Patch Tuesday universe a few years ago. As Tyler Reguly of Fortra
put it
([Dark Reading](https://www.darkreading.com/application-security/patch-tuesday-microsoft-zero-day-sight)):

> Are we aware of all our uses of AI? That number is only going to grow from
> here. What other instances of AI might be in use in your organization that
> are not backed by a company with a regular update schedule like Microsoft?

The implication for any organisation using AI services is that the AI vendor's
own patching discipline becomes an attack-surface concern you have to track.

## VulnTrends context

The question for VulnTrends is whether this story is unique to Microsoft or the
visible signal of an industry-wide shift. The data so far is consistent with the
latter. Microsoft, Palo Alto Networks, Oracle, Mozilla, Fortinet — the
bellwether vendors are all showing similar patterns: more vulnerabilities
disclosed per release, and growing acknowledgement that AI is part of the
explanation. The methodology note on VulnTrends' patch-lag chart is worth
repeating: only CVEs with both a discovery date and a patch date contribute to
the calculation, which can over-represent vendors that publish fuller metadata.
But for the trends robust against that bias, the direction of travel is
unambiguous.

## What happens next

The most useful answer to "what happens next" is also the least satisfying:
nothing dramatic, just a slow break with assumptions that no longer hold. The
monthly release cadence will continue — Microsoft's operational rhythm is far
too valuable to disrupt — but the volume and composition will keep shifting.
Hotpatching will spread. Tiered SLAs will become standard. EPSS and KEV will
become the working substrate of patch prioritisation, with CVSS taking a back
seat. AI-assisted vulnerability discovery will keep getting cheaper and better,
and the gap between what a vendor has triaged as unlikely and what an attacker
can actually exploit will keep narrowing.

Very shortly, somebody (perhaps me!) will write an article about how the August
2026 release broke the July record, and we will have this conversation again.
That, more than any single release, is what has changed: Patch Tuesday is no
longer an event. It is the visible signal of an industry that has finally caught
up to a tempo it has been quietly living with for years.
