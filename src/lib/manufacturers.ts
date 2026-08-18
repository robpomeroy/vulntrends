/**
 * Canonical manufacturer list with display names and chart colours.
 *
 * This is the **single source of truth** for manufacturer colours. All other
 * code (D3 theme, filter UI) derives from this definition:
 *
 *   - `src/lib/d3/theme.ts` imports `getManufacturerColour()` for chart colours
 *   - `src/components/controls/ManufacturerFilter.svelte` calls
 *     `getManufacturerColour()` directly for the chip dots (live import,
 *     so the dots and charts always stay in sync)
 *   - `scripts/aggregate.ts` writes `manufacturers.json` from `MANUFACTURERS`,
 *     but that JSON now supplies only the **name list / order** to the filter
 *     UI — the colours come from this module, not from the JSON
 *
 * When adding a new data source, add its manufacturer here if not already
 * present. Never duplicate colour values elsewhere.
 */

import type { ManufacturerInfo } from '../../scripts/pipeline/types.js';

export const MANUFACTURERS: ManufacturerInfo[] = [
  { name: 'Adobe', colour: '#a86ecd' },
  { name: 'Apple', colour: '#3f6521' },
  { name: 'Cisco', colour: '#568c81' },
  { name: 'Fortinet', colour: '#c39b69' },
  { name: 'Google', colour: '#923881' },
  { name: 'Microsoft', colour: '#fd7eaa' },
  { name: 'Mozilla', colour: '#4fbc6a' },
  { name: 'Oracle', colour: '#11a2f2' },
  { name: 'Palo Alto', colour: '#0d5a9b' },
  { name: 'Samsung', colour: '#b35c05' },
];

/**
 * Default colour used by `getManufacturerColour()` when a manufacturer
 * name isn't in the canonical list (e.g. an unknown vendor from NVD
 * that didn't match any alias). Keeps the dashboard rendering if
 * something slips through the net.
 */
const UNKNOWN_MANUFACTURER_COLOUR = '#a78bfa';

/**
 * Look up the colour for a manufacturer name.
 * Falls back to a neutral purple if not found.
 */
export function getManufacturerColour(name: string): string {
  return (
    MANUFACTURERS.find((m) => m.name === name)?.colour ??
    UNKNOWN_MANUFACTURER_COLOUR
  );
}

/**
 * Get the list of manufacturer names.
 */
export function getManufacturerNames(): string[] {
  return MANUFACTURERS.map((m) => m.name);
}
