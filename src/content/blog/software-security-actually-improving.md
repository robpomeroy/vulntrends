---
title: 'Is Software Security Actually Improving?'
description: 'A look at the data behind the headlines and what it tells us about the state of software security.'
pubDate: 2026-07-18
tags: ['software-security', 'data-analysis', 'vulnerability-trends']
heroImage: '/images/blog/software-security-actually-improving.jpg'
heroImageAlt: 'Is software security actually improving? More vulnerabilities. Smarter defences. A better future?'
---

For more than two decades, we've been fighting what often feels like a losing
battle.

Every month brings another round of security advisories. Another "critical"
vulnerability. Another emergency patch. Another headline warning organisations
to update immediately.

It's easy to conclude that software security is getting worse.

After all, the numbers seem difficult to ignore. The Common Vulnerabilities and
Exposures (CVE) programme records tens of thousands of new vulnerabilities every
year, and the total continues to climb. Vendors are issuing more security
updates than ever before, while security teams struggle to keep pace.

But is that really evidence that software is becoming less secure? Or are we
simply getting better at finding its flaws?

## More vulnerabilities doesn't necessarily mean less secure software

Imagine a city that doubles the number of police officers patrolling its
streets. Crime reports will probably increase. Not necessarily because more
crimes are being committed, but because more crimes are being discovered.

Software vulnerabilities work in much the same way.

A vulnerability only becomes visible once someone finds it. Until then, it may
have existed in the code for months, years, or even decades.

Heartbleed famously existed in OpenSSL for more than two years before anyone
noticed. Other vulnerabilities have remained dormant for considerably longer. In
that sense, the number of published vulnerabilities is often better thought of
as a measure of **discovery**, rather than a direct measure of
**software quality**.

This distinction is surprisingly important.

## The software itself has changed

Modern software engineering bears little resemblance to that of twenty years ago.

Today's developers benefit from:

- automated testing
- static analysis
- fuzz testing
- dependency scanning
- memory sanitizers
- secure development lifecycles
- mandatory code review
- continuous integration pipelines

Many organisations now treat security as an engineering discipline rather than a
compliance exercise. Browsers, for example, have undergone remarkable
architectural improvements. Sandboxing, site isolation, exploit mitigations and
memory-safe components have dramatically raised the bar for attackers.

Likewise, Microsoft's Security Development Lifecycle (SDL), Google's Project
Zero, Mozilla's security engineering teams and countless bug bounty programmes
have all contributed to making software substantially harder to exploit than it
once was. Viewed through this lens, there are good reasons to believe software
engineering is steadily becoming more secure.

## Yet the numbers keep rising

And that's where things become interesting. If development practices are
improving, why do vulnerability counts continue to increase?

Part of the answer is simple: we're looking harder than ever before. The
security research community has grown enormously over the last decade. Bug
bounty programmes have incentivised independent researchers. Fuzzing tools now
discover entire classes of defects automatically. Static analysis has become
commonplace. Academic research continues to produce increasingly sophisticated
techniques for identifying weaknesses.

The consequence is almost inevitable: more vulnerabilities are being found.

Google's Project Zero has repeatedly shown that vendors have generally become
faster at fixing reported vulnerabilities over time, even while the overall
volume of vulnerability reports has increased. That suggests an improving
remediation process alongside increasing discovery.

## The next inflection point

Until recently, discovering vulnerabilities still required considerable
expertise. That assumption is beginning to change.

Large language models are rapidly becoming capable of reasoning about source
code, identifying vulnerable patterns and assisting security researchers in ways
that were barely imaginable a few years ago. While today's systems are far from
replacing experienced vulnerability researchers, they are increasingly acting as
force multipliers rather than simple coding assistants. If AI enables
researchers to inspect ten times as much code in the same amount of time, we
should probably expect vulnerability disclosures to increase.

Paradoxically, that could be good news. A rising number of disclosed
vulnerabilities may not indicate deteriorating software. It may instead indicate
that previously hidden defects are finally being uncovered before attackers
discover them independently.

The more difficult question is whether software vendors can keep pace.

## Discovery versus remediation

Finding vulnerabilities is only half of the equation. Every discovered
vulnerability needs to be:

- investigated
- reproduced
- validated
- prioritised
- fixed
- tested
- released
- deployed by customers

Each of those stages consumes engineering effort.

As AI accelerates discovery, the bottleneck may no longer be finding bugs, but
fixing them. Industry observers are already describing a future where
vulnerability discovery scales much faster than remediation capacity, increasing
pressure on software maintainers and enterprise patch management teams alike. If
that proves true, we may soon find ourselves in an unusual position: software
that is objectively becoming more secure over time, while simultaneously
generating more vulnerability disclosures than ever before.

## So... is software security actually improving?

The honest answer is: **probably—but not for the reason many people assume**.
Individual vulnerabilities are still being discovered every day. Attackers
continue to find novel ways to exploit software. The number of published CVEs
continues to grow.

Yet software development itself is becoming more disciplined, defensive and
security-conscious. At the same time, our ability to discover weaknesses has
improved dramatically.

Those two trends are not contradictory. In fact, they reinforce one another. A
world with more reported vulnerabilities may simply be a world with fewer
undiscovered ones.

## Why VulnTrends exists

This is precisely why I built VulnTrends. Counting vulnerabilities tells only
part of the story. Understanding *how quickly* vendors respond,
*how disclosure rates change over time*, and
*whether remediation keeps pace with discovery* provides a much richer picture
of software security.

The graphs you'll find on VulnTrends won't answer every question. But they can
help challenge assumptions. Because perhaps the most important question in
software security isn't *"How many vulnerabilities were found?"*

It's *"What does that number actually tell us?"*