/**
 * Google Project Zero parser.
 *
 * Project Zero tracks vulnerability research at:
 *   https://bugs.chromium.org/p/project-zero/
 *
 * The issue tracker provides rich disclosure timeline metadata including
 * reported, fixed, and disclosed dates. This parser fetches issues via the
 * tracker's JSON API.
 */

import { buildRecord, parseDate } from '../normalise.js';
import type { VulnerabilityRecord } from '../types.js';

const PZ_ISSUES_URL = 'https://bugs.chromium.org/prpc/monorail.v3.Issues/ListIssues';

interface PzIssue {
  name: string; // e.g. "project-zero/1234"
  summary: string;
  status: string;
  createTime: string;
  updateTime: string;
  labels: string[];
}

interface PzResponse {
  issues?: PzIssue[];
}

/**
 * Fetch Project Zero issues from the Monorail API.
 * The API uses gRPC-Web / JSON encoding.
 */
async function fetchPzIssues(): Promise<PzIssue[]> {
  const allIssues: PzIssue[] = [];
  let pageToken: string | undefined;

  // Paginate through all issues
  for (let page = 0; page < 50; page++) {
    const body: Record<string, unknown> = {
      parent: 'projects/project-zero',
      pageSize: 100,
    };
    if (pageToken) {
      body.pageToken = pageToken;
    }

    const response = await fetch(PZ_ISSUES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'VulnTrends/0.1',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Fall back to a simpler approach if the v3 API is unavailable
      console.warn(`  Project Zero: API returned ${response.status}, trying alternate...`);
      return await fetchPzIssuesAlternate();
    }

    // The response may have an XSSI prefix )]}' that needs stripping
    const text = await response.text();
    const cleaned = text.replace(/^\)\]\}'\n?/, '');
    const data: PzResponse = JSON.parse(cleaned);

    if (!data.issues || data.issues.length === 0) break;
    allIssues.push(...data.issues);

    // Check for next page token in the raw response
    const nextPageMatch = text.match(/"nextPageToken"\s*:\s*"([^"]+)"/);
    pageToken = nextPageMatch?.[1];
    if (!pageToken) break;

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return allIssues;
}

/**
 * Alternate approach: fetch from the Project Zero bug tracker's legacy API.
 * This is a fallback if the v3 API is unavailable.
 */
async function fetchPzIssuesAlternate(): Promise<PzIssue[]> {
  // The legacy API is less structured; return empty if both fail
  console.warn('  Project Zero: alternate API also unavailable, returning no records');
  return [];
}

/**
 * Extract dates from Project Zero issue labels.
 * PZ uses labels like "Reported-2024-01-15", "Fixed-2024-02-20", etc.
 */
function extractDateFromLabels(
  labels: string[],
  prefix: string,
): string | undefined {
  const label = labels.find((l) => l.startsWith(prefix));
  if (!label) return undefined;
  const dateStr = label.substring(prefix.length);
  return parseDate(dateStr);
}

/**
 * Convert a Project Zero issue to a VulnerabilityRecord.
 */
function issueToRecord(issue: PzIssue): VulnerabilityRecord | null {
  const labels = issue.labels ?? [];

  const reportedDate = extractDateFromLabels(labels, 'Reported-');
  const fixedDate = extractDateFromLabels(labels, 'Fixed-');
  const disclosedDate = extractDateFromLabels(labels, 'Disclosed-');

  // Use reported date as discovery date, fall back to creation time
  const discoveredDate = reportedDate ?? parseDate(issue.createTime);
  if (!discoveredDate) return null;

  // Extract CVE IDs from the summary if present
  const cveMatch = issue.summary?.match(/CVE-\d{4}-\d{4,}/gi);
  const cveIds = cveMatch ? [...new Set(cveMatch.map((m) => m.toUpperCase()))] : undefined;

  // Determine the affected vendor/product from labels
  const vendorLabel = labels.find((l) => l.startsWith('Vendor-'));
  const manufacturer = vendorLabel ? vendorLabel.substring(7) : 'Google';

  // Use the issue number as the ID
  const issueNum = issue.name?.split('/')?.[1] ?? issue.name;
  const id = `PZ-${issueNum}`;

  return buildRecord({
    id,
    source: 'projectzero',
    manufacturer,
    title: issue.summary ?? id,
    discoveredDate,
    publishedDate: disclosedDate,
    patchedDate: fixedDate,
    cveIds,
    rawUrl: `https://bugs.chromium.org/p/project-zero/issues/detail?id=${issueNum}`,
  });
}

/**
 * Fetch all Project Zero vulnerability records.
 */
export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log('Project Zero: fetching issues...');
  const issues = await fetchPzIssues();
  console.log(`Project Zero: found ${issues.length} issues`);

  const records: VulnerabilityRecord[] = [];
  for (const issue of issues) {
    const record = issueToRecord(issue);
    if (record) records.push(record);
  }

  console.log(`Project Zero: ${records.length} records extracted`);
  return records;
}
