/**
 * Shared Svelte store for dashboard filter state.
 *
 * Holds the selected manufacturers, granularity, and time-range that all
 * chart components react to.
 */

import { writable } from 'svelte/store';

export type Granularity = 'month' | 'year';

/**
 * A date range filter applied to all charts. `null` means "all time"
 * (no zoom). Stored as ISO date strings (e.g. "2024-01") to match the
 * aggregated chart data format.
 */
export interface DateRange {
  start: string;
  end: string;
}

export interface DashboardState {
  /** Selected manufacturer names (empty = all). */
  selectedManufacturers: string[];
  /** Time granularity for charts. */
  granularity: Granularity;
  /**
   * Active time-range filter. `null` = show all data.
   * Set by the RangeSelector or by the brush on a chart.
   */
  dateRange: DateRange | null;
}

export const dashboardStore = writable<DashboardState>({
  selectedManufacturers: [],
  granularity: 'month',
  dateRange: null,
});

/** Toggle a manufacturer in the selection. */
export function toggleManufacturer(name: string): void {
  dashboardStore.update((state) => {
    const selected = new Set(state.selectedManufacturers);
    if (selected.has(name)) {
      selected.delete(name);
    } else {
      selected.add(name);
    }
    return { ...state, selectedManufacturers: [...selected] };
  });
}

/** Select all manufacturers (clears the filter = show all). */
export function selectAllManufacturers(): void {
  dashboardStore.update((state) => ({
    ...state,
    selectedManufacturers: [],
  }));
}

/** Set the granularity. */
export function setGranularity(granularity: Granularity): void {
  dashboardStore.update((state) => ({ ...state, granularity }));
}

/**
 * Set the date-range filter. Pass `null` to clear the range (show all time).
 * Dates should be in the same format as the aggregated data
 * ("YYYY-MM" for monthly, "YYYY" for yearly).
 */
export function setDateRange(range: DateRange | null): void {
  dashboardStore.update((state) => ({ ...state, dateRange: range }));
}

/** Filter an array of points to those within a date range. */
export function inDateRange<T extends { date: string }>(
  points: T[],
  range: DateRange | null,
): T[] {
  if (!range) return points;
  // Lexicographic comparison works for "YYYY" and "YYYY-MM" formats.
  return points.filter((p) => p.date >= range.start && p.date <= range.end);
}
