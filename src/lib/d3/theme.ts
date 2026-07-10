/**
 * Shared D3 theme — colours, fonts, and constants used across all charts.
 *
 * Manufacturer colours are defined once in `src/lib/manufacturers.ts` and
 * re-exported here for chart components. Do not duplicate the colour values
 * — always source them from MANUFACTURERS.
 */

import { MANUFACTURERS, getManufacturerColour } from '../manufacturers.js';

export const THEME = {
  bgPrimary: '#0f172a',
  bgSecondary: '#1e293b',
  bgTertiary: '#334155',
  textPrimary: '#f1f5f9',
  textSecondary: '#cbd5e1',
  textMuted: '#94a3b8',
  border: '#475569',
  accent: '#38bdf8',
  gridColour: '#334155',
  axisColour: '#475569',
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
} as const;

/**
 * Get the colour for a manufacturer, falling back to "Other".
 * Delegates to the canonical definition in manufacturers.ts.
 */
export function getColour(manufacturer: string): string {
  return getManufacturerColour(manufacturer);
}

// Re-export so chart components can import from a single location if preferred
export { MANUFACTURERS };
