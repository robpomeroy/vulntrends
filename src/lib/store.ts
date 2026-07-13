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

/**
 * Convert a date range from one granularity's string format to another's.
 * The two formats ("YYYY-MM" for monthly, "YYYY" for yearly) are not
 * directly comparable lexicographically, so a range in the wrong format
 * would silently drop every data point.
 *
 * - Monthly → yearly: drop the "-MM" suffix.
 * - Yearly → monthly: start becomes "{YYYY}-01", end becomes "{YYYY}-12".
 *   This expands the yearly range to the full calendar year, which is
 *   the closest match given that a yearly bucket like "2024" aggregates
 *   every month in 2024.
 */
function convertDateRange(
  range: DateRange,
  toGranularity: Granularity,
): DateRange {
  if (toGranularity === 'month') {
    // YYYY → YYYY-MM
    return {
      start: `${range.start}-01`,
      end: `${range.end}-12`,
    };
  }
  // YYYY-MM → YYYY
  return {
    start: range.start.slice(0, 4),
    end: range.end.slice(0, 4),
  };
}

/**
 * Set the granularity, converting the active date range to the new
 * granularity's format if one is set. Without this, a range in
 * "YYYY-MM" form would silently filter out every yearly data point
 * (and vice versa) because "2024" sorts before "2024-01" as a string.
 */
export function setGranularity(granularity: Granularity): void {
  dashboardStore.update((state) => {
    if (state.dateRange && granularity !== state.granularity) {
      return {
        ...state,
        granularity,
        dateRange: convertDateRange(state.dateRange, granularity),
      };
    }
    return { ...state, granularity };
  });
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
