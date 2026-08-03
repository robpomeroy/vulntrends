# Monetisation: operating AdSense on VulnTrends

VulnTrends carries light advertising on content pages (blog posts and chart
explanations) via Google AdSense. The dashboard, about page, blog index, and
privacy page are deliberately ad-free — see the **Monetisation** subsection in
[`AGENTS.md`](../AGENTS.md) for the rationale and the env-var gating pattern.

This guide is the runbook for **going live** with ads, for
**configuring ads in the AdSense dashboard**, and for **changing ads later**.
The code-side implementation lives in `src/lib/ads.ts`,
`src/components/AdSlot.astro`, and the two layouts; the operator-facing steps
live here.

> **Operator context.** We run `npm run publish` on a schedule and read the
> production `.env` from the repo root. The AdSense script is gated entirely by
> two env vars — there is no code toggle to flip and no dashboard URL to revisit
> per-deploy. Activation is a single `.env` change.

---

## 1. Prerequisites

AdSense has two prerequisites before ads can run on a live site:

1. **Site approval.** Google reviews the site before activating ads. Until
   approved, the `<script>` tag and `<ins>` elements load but no ad content
   renders — you'll see empty `<ins>` blocks in the DOM. The publisher-level
   `ca-pub-XXXXXXXXXXXXXXXX` ID alone is *not* enough; an approved site is.
   Approval is signalled in the AdSense dashboard ("Your site is ready").
2. **AdSense CMP configured.** See section 4 below.

If either prerequisite is unmet, the page layout still renders correctly
(scripts load, slots are reserved space) — ads simply don't appear.

---

## 2. Activating ads in production

This is the "before going live" checklist. Each step is a one-time change;
no recurring maintenance required afterwards.

### 2.1 Set the two env vars in `.env`

On the Synology NAS (production):

```ini
# Marketing / AdSense
PUBLIC_ADSENSE_ENABLED=true
PUBLIC_ADSENSE_CLIENT=ca-pub-9736445479382875
```

Replace the `ca-pub-...` value with the one from your AdSense account:
**AdSense dashboard → Account → Account information → Publisher ID**.
(The existing `public/ads.txt` file already contains this ID for direct
ad.txt verification — they should match.)

`staging` should keep `PUBLIC_ADSENSE_ENABLED=false` (or unset). Staging
deploys are auto-excluded regardless — see the staging guard in
`src/lib/ads.ts` — but leaving the var unset on staging prevents anyone
copying production `.env` over staging by accident.

### 2.2 Verify the build pipeline

On the production host, the next `npm run publish` will pick up the new
env vars and emit the AdSense script. To verify locally without deploying:

```bash
PUBLIC_ADSENSE_ENABLED=true \
PUBLIC_ADSENSE_CLIENT=ca-pub-9736445479382875 \
  npm run build
```

then check:

```bash
grep -l "pagead2.googlesyndication.com" dist/blog/ai-finds-bugs-faster-than-humans-can-fix-them/index.html
grep -l "adsbygoogle" dist/blog/ai-finds-bugs-faster-than-humans-can-fix-them/index.html
grep -l "pagead2.googlesyndication.com" dist/charts/discovered/index.html
grep -l "adsbygoogle" dist/charts/discovered/index.html
```

All four should match on the pages with ads. The AdSense `<script>`
tag is only emitted on pages that actually have an AdSlot — the
dashboard, about, blog index, and privacy pages are completely
script-free:

```bash
grep -c "pagead2" dist/index.html
grep -c "pagead2" dist/about/index.html
grep -c "pagead2" dist/blog/index.html
grep -c "pagead2" dist/privacy/index.html
```

Each should return `0`. This is intentional — loading the AdSense
loader on pages with no ads would set cookies and could trigger the
CMP consent dialog on pages with no ads, which would be confusing.

### 2.3 Confirm staging auto-exclusion

`npm run publish` and `npm run publish:staging` both set
`--site https://staging.vulntrends.org` for staging builds. After the change, a
staging deploy should still have no `pagead2` reference in `dist/*.html`. This
is the staging guard working correctly — it prevents analytics from polluting
staging data, and it does the same for ads.

### 2.4 First-week monitoring

After the next daily publish, expect the AdSense dashboard to show:
- Zero impressions on day 1 (the deploy may happen after AdSense's crawler has
  visited; usually picks up within 24–48 hours).
- A handful of impressions and click-throughs by day 3.
- Steady state (10–100 impressions/day) within a week, depending on blog and SEO
  traffic.

If impressions remain zero after a week, see **§6 Troubleshooting**.

---

## 3. Creating ad units in AdSense

The code in `src/components/AdSlot.astro` expects each `<AdSlot>` to reference
an **ad-unit slot ID** — a numeric identifier like `1234567890`. This ID is
generated when you create an ad unit in the AdSense dashboard. Ad units are
independent of the publisher ID; they identify *which* ad (size, format, style)
renders, not *who* is paid.

VulnTrends currently uses two ad units, one per page type:

| Page type | Component | Format | Layout |
|---|---|---|---|
| Blog post (`src/layouts/BlogPost.astro`) | bottom of article | `fluid` | `in-article` |
| Chart page (`src/layouts/ChartPage.astro`) | bottom of explanation | `auto` | (none) |

### 3.1 Create the blog-post ad unit ("In-article")

1. Sign in at [https://adsense.google.com](https://adsense.google.com).
2. Navigate: **Ads → By ad unit → Display ads** (left menu) → **+ New ad unit**
   (top-right button).
3. Choose **"In-article ads"** as the ad type. A side panel opens with the live
   ad preview.
4. **Name**: enter `VulnTrends Blog In-Article` (the name is internal only; it
   appears in your dashboard's ad-unit list, not on the site).
5. **Active ad size**: leave the default ("Fluid"). The `data-ad-format`
   attribute we set (`fluid`) controls the responsive shape — the ad fills the
   slot's width and picks an appropriate height.
6. Click **Create**. The new ad unit's detail page opens.
7. Copy the **Ad unit ID** (a numeric string like `1234567890`).
8. Open `src/layouts/BlogPost.astro` and replace the placeholder:

   ```diff
   -    <AdSlot slot="0000000000" format="fluid" layout="in-article" />
   +    <AdSlot slot="1234567890" format="fluid" layout="in-article" />
   ```

9. Save the file. The next `npm run publish` ships the real ID.

### 3.2 Create the chart-page ad unit ("Display")

1. Same starting point: **Ads → Display ads → + New ad unit**.
2. Choose **"Display ads"** (not "In-article" — display ads suit the wider
   bottom-of-content slot).
3. **Ad size**: pick **"Responsive"** (recommended). AdSense will pick the best
   fit at different viewport widths.
4. **Name**: enter `VulnTrends Chart Bottom`.
5. **Type**: leave as "Display ads" (the default).
6. Click **Create**.
7. Copy the new **Ad unit ID**.
8. Open `src/layouts/ChartPage.astro` and replace the placeholder:

   ```diff
   -    <AdSlot slot="0000000000" />
   +    <AdSlot slot="9876543210" />
   ```

9. Save and ship with the next publish.

### 3.3 Verify end-to-end

After the next `npm run publish`:

```bash
grep "data-ad-slot" dist/blog/ai-finds-bugs-faster-than-humans-can-fix-them/index.html
grep "data-ad-slot" dist/charts/discovered/index.html
```

The output should show the real (non-zero) slot IDs. Note that `grep` over the
source `*.astro` files would *also* show the placeholder because the build keeps
both — the verification is against `dist/`.

Click through on the live site and check that an ad actually renders. The first
time after enabling, you may see "ads by Google" placeholder text for a few
minutes while AdSense's crawler fetches the page.

---

## 4. Configuring the CMP (consent dialog)

Google's Consent Management Platform (CMP) is built into the AdSense script.
When the script loads on a page, Google displays a consent dialog to users in
the **EEA, UK, and Switzerland** based on settings you configure in the AdSense
dashboard. No code change is required on VulnTrends — only a one-time dashboard
configuration.

**Important scope note:** the AdSense `<script>` tag is only emitted on pages
that actually have an AdSlot — blog posts and chart click-through pages. The
dashboard, about page, blog index, and privacy page are deliberately
script-free, so the CMP dialog will never appear there. This is intentional:
a consent dialog on a page with no ads is confusing. Verify the CMP on a
blog post or chart page, not on `/`.

### 4.1 Configure the consent message

1. Sign in to the AdSense dashboard.
2. Navigate: **Privacy & messaging → European regulations** (or
   **Privacy & messaging → Manage** if the menu differs).
3. You should see a **"Create a GDPR message"** or **"Edit"** option.
4. Configure as follows (defaults are fine for most settings):

   | Setting | Recommended |
   |---|---|
   | **Audience** | Users in the EEA, UK, and Switzerland |
   | **Consent mode** | Basic consent (Google's default) |
   | **Ad technology providers** | Use the "**Commonly used set**" — Google's curated default. If a specific ATP needs to be excluded or added, use the "Custom set" option. |
   | **Message text** | Customise the heading and body if you want a less corporate feel (Google's defaults are formal). The site name should remain "VulnTrends". |
   | **Display options** | **Bottom-of-screen banner** (less intrusive than a modal). **Dismiss-on-consent** (recommended). |
   | **URLs** | Link to your own privacy policy (`https://vulntrends.org/privacy/`) — AdSense requires a link in the consent dialog. |

5. Click **Publish** or **Save**.

### 4.2 Verify the CMP

After the CMP is published:

1. Open a **page with an ad** in a browser — e.g.
   `https://vulntrends.org/blog/ai-finds-bugs-faster-than-humans-can-fix-them/`
   or `https://vulntrends.org/charts/discovered/`. (The dashboard, about,
   blog index, and privacy pages are ad-free — see the scope note above.)
2. Set the browser's location to an EEA country (Chrome DevTools → Sensors →
   Location → set to "Berlin (51.5, -0.13)" or similar).
3. Reload. The consent banner should appear at the bottom of the screen.
4. Click "Accept" / "Reject" / "Manage options" — your choice is stored in a
   first-party cookie and the banner should not reappear on subsequent loads.

If the banner doesn't appear, see **§6 Troubleshooting**.

### 4.3 What Plausible sees

Plausible is cookieless and doesn't set cookies, so it does **not** require a
consent banner under GDPR. The CMP dialog covers AdSense only.

---

## 5. Changing ads later

### 5.1 Adding a new blog post with the existing ad unit

Nothing to do — the `<AdSlot>` is in `BlogPost.astro` and will render
on every blog post automatically when ads are enabled.

### 5.2 Adding an ad to a new page type

1. Decide where the ad should go (above the fold? below content? sidebar?).
2. Update or create an Astro layout that emits the `<AdSlot>` in the right
   position — the `AdSlot.astro` component takes a `slot` prop (the ad unit ID),
   optional `format` (default `"auto"`), and optional `layout` (e.g.
   `"in-article"`).
3. Create the matching ad unit in AdSense (section 3) and paste the
   ID into the `slot` prop.

### 5.3 Disabling ads temporarily

To pause ads without removing the code, set on the Synology `.env`:

```ini
PUBLIC_ADSENSE_ENABLED=false
```

and re-run `npm run publish`. The script and slots are gated by the same three
guards that gate Plausible (`PUBLIC_*_ENABLED` + staging exclude + value
present). No code revert is needed; the slots render as no-ops.

### 5.4 Removing ads permanently

1. Remove the `<AdSlot>` imports from `BlogPost.astro` and
   `ChartPage.astro`.
2. Remove the AdSense `<script>` blocks from both layouts' `<head>`.
3. Remove the `.vt-ad` and `.vt-ad-label` CSS from `global.css`.
4. Delete `public/ads.txt` (not strictly necessary if you stop serving ads —
   AdSense will simply ignore it — but cleaner).
5. Keep `docs/monetisation.md` as a record of the decision; the privacy policy
   stays (the policy is honest regardless of whether ads are currently shown).

### 5.5 Switching to a different ad network

AdSense-specific code lives in three places: the `<script>` tag in both layouts,
the `<ins>` element in `AdSlot.astro`, and the `data-` attributes. To switch
(e.g. to Mediavine, which is more selective):

1. Sign up with the new network, get the publisher ID.
2. Create ad units in the new dashboard; copy the new IDs.
3. Replace the `<script>` src and `data-ad-client` values in both layouts (and
   `AdSlot.astro`'s `data-ad-client` and `data-ad-slot`).
4. Update `PUBLIC_ADSENSE_*` env vars to whatever the new network uses (rename
   them or just change the values).
5. Update `docs/monetisation.md` with the new workflow.

The remaining plumbing (slot rendering, env-var gating, staging exclude,
"Advertisement" label, `.vt-ad` styles) is network-agnostic and stays as-is.

---

## 6. Troubleshooting

### Ads don't appear after enabling

1. **Check the env vars are set on the Synology `.env`** — the build reads
   `.env` at `npm run publish` time. A missing var means `getAdsConfig` returns
   `enabled: false`.
2. **Check the build was actually rebuilt** — `npm run publish` runs
   `npm run build`, but if you edited `.env` *after* the last publish, wait for
   the next scheduled run.
3. **Check the `<script>` is in the HTML on a page with ads** —
   `grep pagead2 dist/blog/ai-finds-bugs-faster-than-humans-can-fix-them/index.html`
   or `grep pagead2 dist/charts/discovered/index.html`. Should match (one
   occurrence in `<head>`). Don't check `dist/index.html` (the dashboard) —
   that page is deliberately ad-free by design and the script is never
   emitted there, even when ads are enabled. If the script is absent on
   a page with ads, the staging guard is tripping (your hostname starts
   with `staging.`).
4. **Check the AdSense dashboard status** — "Your account is being reviewed"
   means ads won't render yet.

### The CMP consent banner doesn't appear for EEA visitors

1. **Check you're on a page with ads.** The CMP only loads on blog posts
   and chart pages. Test on `/blog/<slug>/` or `/charts/<chart>/`, not on
   `/`. See section 4's scope note.
2. **Check the AdSense dashboard** → Privacy & messaging → European regulations.
   The message must be **Published**, not in draft.
3. **Check the location detection** — test in Chrome DevTools with Sensors →
   Location overridden to an EEA capital. AdSense uses IP geolocation in
   production; VPNs and corporate proxies may give false locations.
4. **Check that the URL field in the CMP message points to a working privacy
   policy page** — AdSense requires this for the "Learn more" link in the
   consent dialog. Use `https://vulntrends.org/privacy/`.

### The dashboard is showing ads

This would be a regression. The dashboard layout does not import
`AdSlot`, and the AdSense `<script>` tag is not emitted on the
dashboard (the `hasAds` prop defaults to `false`). If you see ads on
`/`:

1. `grep -c "pagead2" dist/index.html` — should return `0`. If it
   returns more, the script was unexpectedly emitted.
2. `grep -c "adsbygoogle" dist/index.html` — should return `0`. If
   it returns more, an `<AdSlot>` was unexpectedly rendered.
3. Check that `src/layouts/Dashboard.astro` doesn't have an
   `<AdSlot>` import or emission, and that `src/pages/index.astro`
   doesn't pass `hasAds` to the layout.

### AdSense account suspended or disabled

If AdSense disables the account:

1. Set `PUBLIC_ADSENSE_ENABLED=false` immediately.
2. Re-run `npm run publish`.
3. The site continues to render without ads.
4. Once AdSense resolves the issue, re-enable per section 2.

### Revenue is unexpectedly low

Five things to check, in order:

1. **Geographic mix.** Most impressions come from search traffic; the geographic
   origin of those users affects which ATPs can bid and the resulting CPM.
2. **Block categories.** AdSense's "Blocking controls" page lets you exclude
   categories (e.g. "dating", "alcohol"). The default blocks vary by region.
3. **Ad unit placement.** In-article ads typically outperform bottom-of-content
   ads. The current placement (one in-article per blog post, one display per
   chart page) is the recommended middle ground — not too aggressive, not too
   sparse.
4. **Page traffic.** AdSense revenue scales with impressions, not with
   revenue-per-impression. As blog and SEO traffic grow (the chart pages have
   JSON-LD Dataset markup that helps with Google dataset search), impressions
   grow automatically.
5. **AdSense "Optimization" suggestions** — the dashboard's personalisation
   panel often recommends specific changes based on your traffic. Check it after
   the first month.

---

## Related files

| File | What it does |
|---|---|
| [`src/lib/ads.ts`](../src/lib/ads.ts) | Shared helper. `getAdsConfig(site)` returns `{ enabled, client }` after applying the three guards. |
| [`src/components/AdSlot.astro`](../src/components/AdSlot.astro) | The reusable ad slot — renders the `<ins>` + activation script when enabled. Props: `slot`, optional `format`, optional `layout`. |
| [`src/layouts/Dashboard.astro`](../src/layouts/Dashboard.astro) | Loads the AdSense `<script>` in `<head>` only when the page passes `hasAds={true}` (blog posts only). Privacy link in the footer Project column. |
| [`src/layouts/ChartPage.astro`](../src/layouts/ChartPage.astro) | Loads the AdSense `<script>` in `<head>`; renders an `<AdSlot>` at the bottom of the explanation section; Privacy link in the footer. |
| [`src/layouts/BlogPost.astro`](../src/layouts/BlogPost.astro) | Renders an in-article `<AdSlot>` after the article body. |
| [`src/pages/privacy.astro`](../src/pages/privacy.astro) | Privacy policy. Required disclosure under GDPR/UK GDPR and AdSense's publisher agreement. |
| [`src/styles/global.css`](../src/styles/global.css) | `.vt-ad` and `.vt-ad-label` styles at the bottom of the file. |
| [`public/ads.txt`](../public/ads.txt) | AdSense authorised-sellers declaration. Required for AdSense; auto-copied to `dist/ads.txt` by `astro build`. |
| [`.env.example`](../.env.example) | The `Advertising (AdSense)` section documents both env vars. |
| [`AGENTS.md`](../AGENTS.md) | The Monetisation subsection captures the *why*; this file captures the *how*. |
