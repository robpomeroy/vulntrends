/**
 * Shared D3 theme — colours, fonts, and constants used across all charts.
 */

export const THEME = {
  bgPrimary: '#0f172a',
  bgSecondary: '#1e293b',
  bgTertiaryary: '#334155',
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

/** Manufacturer colour palette. */
export const MANUFACTURER_COLOURS: Record<string, string> = {
  Mozilla: '#ff7133',
  Google: '#4285f4',
  Microsoft: '#00a4ef',
  Apple: '#a8a8a8',
  Oracle: '#c74634',
  Samsung: '#364fc7',
  Linux: '#f6c924',
  Other: '#a78bfa',
};

/** Get the colour for a manufacturer, falling back to "Other". */
export function getColour(manufacturer: string): string {
  return MANUFACTURER_COLOURS[manufacturer] ?? MANUFACTURER_COLOURS.Other;
}
