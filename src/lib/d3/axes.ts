/**
 * Shared D3 axis formatters for month/year granularity.
 */

import { axisBottom, axisLeft } from 'd3-axis';
import { timeFormat } from 'd3-time-format';

const monthFormat = timeFormat('%b %Y');
const yearFormat = timeFormat('%Y');

/** Format a date for axis ticks based on granularity. */
export function formatAxisDate(granularity: 'month' | 'year'): (d: Date) => string {
  return granularity === 'month' ? monthFormat : yearFormat;
}

/** Create a bottom axis with date formatting. */
export function createBottomAxis(
  scale: { ticks: (count?: number) => Date[] },
  granularity: 'month' | 'year',
) {
  return axisBottom(scale as never)
    .tickFormat(formatAxisDate(granularity) as never)
    .ticks(granularity === 'month' ? 6 : 10);
}

/** Create a left axis for counts. */
export function createLeftAxis(scale: unknown) {
  return axisLeft(scale as never).ticks(6);
}
