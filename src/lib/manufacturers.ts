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
  { name: 'Mozilla', colour: '#ff7133' },
  { name: 'Google', colour: '#4285f4' },
  { name: 'Microsoft', colour: '#00a4ef' },
  { name: 'Apple', colour: '#a8a8a8' },
  { name: 'Oracle', colour: '#c74634' },
  { name: 'Samsung', colour: '#1428a0' },
  { name: 'Palo Alto', colour: '#fa582d' },
  { name: 'Fortinet', colour: '#00b14f' },
  { name: 'Cisco', colour: '#1ba0d7' },
  { name: 'Adobe', colour: '#d4261f' },
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
