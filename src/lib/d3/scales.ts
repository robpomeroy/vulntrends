/**
 * Shared D3 scale factories.
 */

import { scaleLinear, scaleOrdinal, scaleTime } from 'd3-scale';
import { getColour } from './theme.js';

/** Create a time-based x-scale for date-based charts. */
export function createTimeScale(
  domain: [Date, Date],
  range: [number, number],
) {
  return scaleTime().domain(domain).range(range);
}

/** Create a linear y-scale for count-based charts. */
export function createLinearScale(
  domain: [number, number],
  range: [number, number],
) {
  return scaleLinear().domain(domain).range(range).nice();
}

/** Create a colour scale keyed by manufacturer name. */
export function createColourScale(manufacturers: string[]) {
  return scaleOrdinal<string, string>()
    .domain(manufacturers)
    .range(manufacturers.map(getColour));
}

/** Chart dimensions with sensible defaults. */
export const CHART_DIMENSIONS = {
  marginTop: 16,
  marginRight: 16,
  marginBottom: 32,
  marginLeft: 48,
} as const;
