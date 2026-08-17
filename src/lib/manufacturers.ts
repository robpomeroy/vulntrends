/**
 * Canonical manufacturer list with display names and chart colours.
 *
 * This is the **single source of truth** for manufacturer colours. All other
 * code (D3 theme, aggregated JSON, filter UI) derives from this definition:
 *
 *   - `src/lib/d3/theme.ts` imports `getManufacturerColour()` for chart colours
 *   - `scripts/aggregate.ts` writes `manufacturers.json` from `MANUFACTURERS`
 *   - The build-time loader reads that JSON and passes it to the filter UI
 *
 * When adding a new data source, add its manufacturer here if not already
 * present. Never duplicate colour values elsewhere.
 */

import type { ManufacturerInfo } from '../../scripts/pipeline/types.js';

export const MANUFACTURERS: ManufacturerInfo[] = [
  { name: 'Mozilla', colour: '#c2d0dc' },
  { name: 'Google', colour: '#05292a' },
  { name: 'Microsoft', colour: '#985d70' },
  { name: 'Apple', colour: '#85b18e' },
  { name: 'Oracle', colour: '#2c5f42' },
  { name: 'Samsung', colour: '#673449' },
  { name: 'Palo Alto', colour: '#c693af' },
  { name: 'Fortinet', colour: '#5f8fb5' },
  { name: 'Cisco', colour: '#535c8d' },
  { name: 'Adobe', colour: '#6d7c4f' },
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
