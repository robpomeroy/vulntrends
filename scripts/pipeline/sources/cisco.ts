/**
 * Cisco security advisories parser — NVD-only coverage with auth stub.
 *
 * Cisco's structured advisory feeds were historically available as
 * OXML (OASIS) and an openVuln REST API. The OXML feed
 * (`/security/center/psirtrss20/cisco_0.xml`) was deprecated and now
 * returns "Feed data is not available at this time". The openVuln
 * API requires an OAuth client_id/secret obtained from the Cisco
 * API Console.
 *
 * For now, this parser returns an empty array and logs a one-time
 * message explaining the situation. The dashboard still gets Cisco
 * coverage from the NVD source (added via the `cisco` CPE vendor
 * entry in `scripts/pipeline/sources/nvd.ts`), which contributes
 * `discoveredDate` (CVE published) for Cisco-tagged CVEs. What's
 * missing compared to a full parser is Cisco's own patch-timing data.
 *
 * To upgrade later:
 *   1. Register a Cisco API client at https://apiconsole.cisco.com/
 *   2. Implement OAuth2 client-credentials flow
 *   3. Fetch from `https://api.cisco.com/security/advisories/v2/...`
 *   4. Map the response to VulnerabilityRecord (CVE ID, publication
 *      date, CVSS, severity, fixed-version date).
 *
 * The function signature and `source: 'cisco'` are already wired up
 * through the pipeline orchestrator, so the upgrade is a no-op
 * from the data model's perspective.
 */

import type { VulnerabilityRecord } from '../types.js';

const SENTINEL = Symbol.for('cisco-empty-result-shown');

export async function fetchRecords(): Promise<VulnerabilityRecord[]> {
  // Log a one-time warning, not per-call.
  const g = globalThis as unknown as Record<symbol, boolean>;
  if (!g[SENTINEL]) {
    g[SENTINEL] = true;
    console.log(
      '  Cisco: no public advisory feed available ' +
        '(openVuln API requires OAuth; OXML feed deprecated). ' +
        'Coverage for Cisco is provided by the NVD source.',
    );
  }
  return [];
}
