/**
 * Shared Svelte store for dashboard filter state.
 *
 * Holds the selected manufacturers and granularity (month/year) that all
 * chart components react to.
 */

import { writable } from 'svelte/store';

export type Granularity = 'month' | 'year';

export interface DashboardState {
  /** Selected manufacturer names (empty = all). */
  selectedManufacturers: string[];
  /** Time granularity for charts. */
  granularity: Granularity;
}

export const dashboardStore = writable<DashboardState>({
  selectedManufacturers: [],
  granularity: 'month',
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
