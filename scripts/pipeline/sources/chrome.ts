/**
 * Google Chrome security releases parser.
 *
 * Chrome security updates are published on the Chrome Releases blog:
 *   https://chromereleases.googleblog.com/
 *
 * The blog is HTML and needs scraping. Each stable-channel update post
 * lists CVE IDs and severity ratings. Patch dates are the blog post dates.
 */

import { buildRecord, parseDate } from '../normalise.js';
import { fetchWithRetry } from '../fetch-with-retry.js';
import type { VulnerabilityRecord } from '../types.js';

const CHROME_BLOG_URL = 'https://chromereleases.googleblog.com/';

interface ChromeUpdate {
  title: string;
  url: string;
  date: string;
  cveIds: string[];
  severities: string[];
}

/**
 * Fetch the Chrome Releases blog and extract stable channel update posts.
 */
async function fetchUpdatePosts(): Promise<ChromeUpdate[]> {
  const updates: ChromeUpdate[] = [];
  let nextUrl: string | undefined = CHROME_BLOG_URL;

  // Paginate through the blog — follow "Older Posts" links
  for (let page = 0; page < 100; page++) {
    if (!nextUrl) break;

    const response = await fetchWithRetry(nextUrl, {
      headers: { 'User-Agent': 'VulnTrends/0.1 (https://github.com/vulntrends)' },
    });
    if (!response.ok) {
      console.warn(`  Chrome: blog fetch failed at page ${page}: ${response.status}`);
      break;
    }
    const html: string = await response.text();

    // Extract blog post entries — Chrome releases uses Blogger's HTML structure
    // Posts have class "post" and contain date headers
    const postRegex =
      /<article[^>]*class="[^"]*post[^"]*"[^>]*>[\s\S]*?<h3[^>]*><a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<time[^>]*datetime="([^"]+)"[\s\S]*?<\/article>/gi;

    let match: RegExpExecArray | null;
    while ((match = postRegex.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].trim();
      const date = parseDate(match[3]);

      // Only interested in stable channel security posts.
      // The "stable channel" / "stable update" check also implicitly
      // filters out posts with empty titles (empty string won't match
      // the regex), so by this point title is guaranteed non-empty.
      if (!title.match(/stable channel|stable update/i)) continue;
      if (!date) continue;

      // Fetch the full post to extract CVE details
      updates.push({
        title,
        url,
        date,
        cveIds: [],
        severities: [],
      });
    }

    // Find "Older Posts" link
    const olderMatch: RegExpMatchArray | null = html.match(
      /<a[^>]*class="[^"]*blog-pager-older-link[^"]*"[^>]*href="([^"]+)"/i,
    );
    nextUrl = olderMatch?.[1];

    if (nextUrl) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return updates;
}

/**
 * Fetch a single Chrome release blog post and extract CVE details.
 */
async function enrichUpdate(update: ChromeUpdate): Promise<ChromeUpdate> {
  try {
    const response = await fetchWithRetry(update.url, {
      headers: { 'User-Agent': 'VulnTrends/0.1 (https://github.com/vulntrends)' },
    });
    if (!response.ok) return update;
    const html = await response.text();

    // Extract CVE IDs
    const cveRegex = /CVE-\d{4}-\d{4,}/gi;
    const cveMatches = html.match(cveRegex);
    update.cveIds = cveMatches
      ? [...new Set(cveMatches.map((m) => m.toUpperCase()))]
      : [];

    // Extract severity — Chrome uses "High", "Medium", "Low"
    const severityRegex = /"(High|Medium|Low|Critical)"/gi;
    const severityMatches = html.match(severityRegex);
    update.severities = severityMatches
      ? [...new Set(severityMatches.map((m) => m.replace(/"/g, '')))]
      : [];

    return update;
  } catch {
    return update;
  }
}

/**
 * Fetch all Google Chrome vulnerability records.
 */
export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Google Chrome: fetching release blog...');
  const updates = await fetchUpdatePosts();
  console.log(`Google Chrome: found ${updates.length} stable channel updates`);

  // Enrich updates with CVE details (in small batches)
  const allRecords: VulnerabilityRecord[] = [];
  const batchSize = 5;

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const enriched = await Promise.all(batch.map(enrichUpdate));

    for (const update of enriched) {
      if (update.cveIds.length === 0) {
        // Some posts don't list individual CVEs — create one record per post
        allRecords.push(
          buildRecord({
            id: `chrome-${update.date}`,
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

    if (i + batchSize < updates.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  console.log(`Google Chrome: ${allRecords.length} records extracted`);
  return allRecords;
}
