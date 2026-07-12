<script lang="ts">
  /**
   * RangeSelector — quick-range preset buttons for time-range filtering.
   *
   * Provides common date range presets (Last 12 months, Last 2 years, All time)
   * plus a "View all" reset option. The actual time-range state lives in the
   * shared dashboardStore, so this component stays in sync across all charts.
   *
   * The presets are computed relative to the most recent date in the
   * aggregated data (not the current calendar date), which avoids
   * edge cases at the end of the year.
   */

  import {
    dashboardStore,
    setDateRange,
    type DateRange,
    type Granularity,
  } from '@/lib/store';

  interface Props {
    /** The latest available date in the data, used to anchor the presets. */
    latestDate: string;
    /** Current data granularity (affects preset calculations). */
    granularity: Granularity;
  }

  let { latestDate, granularity }: Props = $props();

  let currentRange = $derived($dashboardStore.dateRange);

  /**
   * Compute a DateRange for a preset relative to the latest date.
   * Returns null for "all time".
   */
  function computePreset(preset: 'year' | '2y' | 'all'): DateRange | null {
    if (preset === 'all') return null;

    const [yearStr, monthStr] = latestDate.split('-');
    const year = parseInt(yearStr, 10);
    const month = monthStr ? parseInt(monthStr, 10) : 12;

    let startYear: number;
    if (preset === 'year') {
      // Last 12 months: start = (year-1, same month)
      startYear = year - 1;
    } else {
      // Last 2 years: start = (year-2, same month)
      startYear = year - 2;
    }
    const start = granularity === 'month'
      ? `${startYear}-${String(month).padStart(2, '0')}`
      : `${startYear}`;
    return { start, end: latestDate };
  }

  /** Check if a preset is currently active. */
  function isActive(preset: 'year' | '2y' | 'all'): boolean {
    if (preset === 'all') return currentRange === null;
    const target = computePreset(preset);
    if (!target) return false;
    return (
      currentRange !== null &&
      currentRange.start === target.start &&
      currentRange.end === target.end
    );
  }

  function selectPreset(preset: 'year' | '2y' | 'all') {
    setDateRange(computePreset(preset));
  }

  let yearLabel = $derived(computePreset('year')?.start ?? '');
</script>

<div class="flex items-center gap-1" role="group" aria-label="Time range">
  <button
    type="button"
    class="text-xs px-2 py-1 rounded transition-colors
      {isActive('year')
        ? 'bg-vt-accent text-vt-bg-primary font-semibold'
        : 'text-vt-text-muted hover:text-vt-text-primary hover:bg-vt-bg-tertiary'}"
    onclick={() => selectPreset('year')}
    aria-pressed={isActive('year')}
    title="Last 12 months from {latestDate}"
  >
    Last year
  </button>
  <button
    type="button"
    class="text-xs px-2 py-1 rounded transition-colors
      {isActive('2y')
        ? 'bg-vt-accent text-vt-bg-primary font-semibold'
        : 'text-vt-text-muted hover:text-vt-text-primary hover:bg-vt-bg-tertiary'}"
    onclick={() => selectPreset('2y')}
    aria-pressed={isActive('2y')}
    title="Last 2 years from {latestDate}"
  >
    Last 2 years
  </button>
  <button
    type="button"
    class="text-xs px-2 py-1 rounded transition-colors
      {isActive('all')
        ? 'bg-vt-accent text-vt-bg-primary font-semibold'
        : 'text-vt-text-muted hover:text-vt-text-primary hover:bg-vt-bg-tertiary'}"
    onclick={() => selectPreset('all')}
    aria-pressed={isActive('all')}
  >
    All time
  </button>
  {#if currentRange !== null}
    <span class="text-xs text-vt-text-muted ml-1">
      ({currentRange.start} → {currentRange.end})
    </span>
  {/if}
</div>
