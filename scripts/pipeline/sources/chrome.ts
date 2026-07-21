/**
 * Google Chrome security releases parser.
 *
 * Chrome security updates are published on the Chrome Releases blog:
 *   https://chromereleases.googleblog.com/
 *
 * Source: Blogger's Atom JSON feed, filtered to the "Stable updates"
 * and "Stable channel update" categories. The HTML page is subject to
 * ad-network redirects that break scraping; the Atom feed is the
 * canonical machine-readable form and does not have that problem.
 *
 * Feed URL: https://chromereleases.googleblog.com/feeds/posts/default/-/Stable%20updates?alt=json
 *
 * Pagination: Blogger's JSON feed uses `start-index` and `max-results`
 * query parameters. Each page is up to 150 entries.
 */

import { createHash } from 'node:crypto';
import { buildRecord, parseDate } from '../normalise.js';
import { fetchWithRetry } from '../fetch-with-retry.js';
import type { VulnerabilityRecord } from '../types.js';

const CHROME_FEED_URL =
  'https://chromereleases.googleblog.com/feeds/posts/default/-/Stable%20updates?alt=json';
const FEED_PAGE_SIZE = 150;
const FEED_MAX_PAGES = 20; // 20 × 150 = 3000 entries — far more than history needs

interface ChromeUpdate {
  title: string;
  url: string;
  date: string;
  cveIds: string[];
  severities: string[];
  /** HTML body of the blog post, used for CVE/severity extraction. */
  bodyHtml: string;
}

interface AtomEntry {
  title: { $t: string };
  published: { $t: string };
  link?: Array<{ rel?: string; href: string; type?: string }>;
  category?: Array<{ term: string }>;
  content?: { $t: string };
}

interface AtomFeed {
  feed?: {
    entry?: AtomEntry[];
    openSearch$totalResults?: { $t: string };
  };
}

/**
 * Fetch Chrome stable-channel release posts from the Atom feed.
 */
async function fetchUpdatePosts(): Promise<ChromeUpdate[]> {
  const updates: ChromeUpdate[] = [];

  for (let page = 0; page < FEED_MAX_PAGES; page++) {
    const startIndex = page * FEED_PAGE_SIZE + 1;
    const url = `${CHROME_FEED_URL}&max-results=${FEED_PAGE_SIZE}&start-index=${startIndex}`;
    const response = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'VulnTrends/0.1 (https://github.com/vulntrends)' },
    });
    if (!response.ok) {
      console.warn(`  Chrome: feed fetch failed at page ${page}: ${response.status}`);
      break;
    }
    const data = (await response.json()) as AtomFeed;
    const entries = data.feed?.entry ?? [];
    if (entries.length === 0) break;

    for (const entry of entries) {
      // The feed is filtered to "Stable updates" via the URL path
      // (`/-/Stable%20updates`). Some legacy entries may be tagged
      // "Stable channel update" instead — accept those too.
      const categories = (entry.category ?? []).map((c) => c.term.toLowerCase());
      const isStableUpdate =
        categories.some((c) => c.includes('stable updates')) ||
        categories.some((c) => c.includes('stable channel update'));
      if (!isStableUpdate) continue;

      const title = entry.title?.$t?.trim();
      if (!title) continue;

      // Prefer the alternate HTML link; fall back to the first link.
      const link =
        entry.link?.find((l) => l.rel === 'alternate')?.href ?? entry.link?.[0]?.href;
      if (!link) continue;

      const date = parseDate(entry.published?.$t);
      if (!date) continue;

      updates.push({
        title,
        url: link,
        date,
        cveIds: [],
        severities: [],
        bodyHtml: entry.content?.$t ?? '',
      });
    }

    if (entries.length < FEED_PAGE_SIZE) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return updates;
}

/**
 * Extract CVE IDs and severity ratings from a Chrome release post's
 * HTML body. The body comes from the Atom feed's `content.$t` field,
 * so no per-post HTTP request is needed.
 */
function enrichUpdate(update: ChromeUpdate): ChromeUpdate {
  const html = update.bodyHtml;

  // Extract CVE IDs
  const cveRegex = /CVE-\d{4}-\d{4,}/gi;
  const cveMatches = html.match(cveRegex);
  update.cveIds = cveMatches
    ? [...new Set(cveMatches.map((m) => m.toUpperCase()))]
    : [];

  // Extract severity — Chrome uses "High", "Medium", "Low", "Critical"
  const severityRegex = /"(High|Medium|Low|Critical)"/gi;
  const severityMatches = html.match(severityRegex);
  update.severities = severityMatches
    ? [...new Set(severityMatches.map((m) => m.replace(/"/g, '')))]
    : [];

  return update;
}

/**
 * Fetch all Google Chrome vulnerability records.
 */
export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Google Chrome: fetching release blog...');
  const updates = await fetchUpdatePosts();
  console.log(`Google Chrome: found ${updates.length} stable channel updates`);

  // Enrich updates with CVE details from the already-fetched post bodies
  const allRecords: VulnerabilityRecord[] = [];

  for (const update of updates.map(enrichUpdate)) {
      if (update.cveIds.length === 0) {
        // Some posts don't list individual CVEs — create one record
        // per post. The id is derived from the post URL (hashed for
        // brevity) so that two posts on the same date without CVEs
        // don't collide in the dedup pass, which keys no-CVE records
        // purely by id.
        const id = `chrome-${createHash('sha256').update(update.url).digest('hex').slice(0, 12)}`;
        allRecords.push(
          buildRecord({
            id,
            source: 'chrome',
            manufacturer: 'Google',
            product: 'Chrome',
            title: update.title,
            discoveredDate: update.date,
            patchedDate: update.date,
            rawUrl: update.url,
          }),
        );
      } else {
        // Create one record per CVE
        for (const cveId of update.cveIds) {
          allRecords.push(
            buildRecord({
              id: cveId,
              source: 'chrome',
              manufacturer: 'Google',
              product: 'Chrome',
              title: `${update.title} — ${cveId}`,
              discoveredDate: update.date,
              patchedDate: update.date,
              cveIds: [cveId],
              rawUrl: update.url,
            }),
          );
        }
      }
  }

  console.log(`Google Chrome: ${allRecords.length} records extracted`);
  return allRecords;
}
