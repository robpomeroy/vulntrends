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
  { name: 'Linux', colour: '#f6c924' },
  { name: 'Other', colour: '#a78bfa' },
];

/**
 * Look up the colour for a manufacturer name.
 * Falls back to the "Other" colour if not found.
 */
export function getManufacturerColour(name: string): string {
  return (
    MANUFACTURERS.find((m) => m.name === name)?.colour ??
    MANUFACTURERS.find((m) => m.name === 'Other')!.colour
  );
}

/**
 * Get the list of manufacturer names.
 */
export function getManufacturerNames(): string[] {
  return MANUFACTURERS.map((m) => m.name);
}
