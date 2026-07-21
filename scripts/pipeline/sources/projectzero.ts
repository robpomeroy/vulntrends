/**
 * Google Project Zero parser — deprecated stub.
 *
 * Project Zero historically tracked vulnerability research at:
 *   https://bugs.chromium.org/p/project-zero/
 *
 * That instance was retired by Google and migrated to the new
 * `issuetracker.google.com` platform. The Monorail endpoint used
 * here (`/prpc/monorail.v3.Issues/ListIssues`) returns HTTP 404.
 *
 * This stub returns an empty array. The dashboard still gets
 * Project Zero coverage indirectly via the NVD source, which
 * includes the `google` vendor (NVD CVEs that Google published or
 * were disclosed against Google products). What's missing compared
 * to a full parser is the rich Project Zero timeline metadata
 * (Reported / Fixed / Disclosed dates).
 *
 * To upgrade later:
 *   1. Use issuetracker.google.com's public REST API. Project Zero's
 *      component ID there is 1458527 (verify before implementing).
 *   2. Map issue fields (subject, hotlist membership, status) to
 *      VulnerabilityRecord. Note that disclosed/fixed dates are now
 *      stored as hot-fields rather than labels, so the parser logic
 *      is structurally different from the Monorail version.
 *   3. Fetch CVE IDs from the issue's "CVE IDs" hot-field.
 *
 * The function signature and `source: 'projectzero'` are already
 * wired up through the pipeline orchestrator, so the upgrade is a
 * no-op from the data model's perspective.
 */

import type { VulnerabilityRecord } from '../types.js';

/**
 * Fetch all Project Zero vulnerability records.
 *
 * Returns an empty array because the source API has been retired.
 */
export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  console.log(
    'Project Zero: source retired (Monorail endpoint deprecated, migrated to issuetracker.google.com) — relying on NVD for Google coverage',
  );
  return [];
}
