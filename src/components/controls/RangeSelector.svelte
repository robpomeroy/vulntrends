<script lang="ts">
  /**
   * RangeSelector — quick-range preset buttons for time-range filtering.
   *
   * Provides common date range presets (Last year, Last 2 years, All time).
   * The actual time-range state lives in the shared dashboardStore, so this
   * component stays in sync across all charts.
   *
   * The presets are computed relative to the most recent date in the
   * aggregated data (not the current calendar date), which avoids
   * edge cases at the end of the year.
   */

  import {
    dashboardStore,
    setDateRange,
    FULL_COVERAGE_START_YEAR,
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
   *
   * In monthly mode the labels read "Last 12 months" / "Last 24 months",
   * so we subtract 11/23 months from latestDate to get a range that
   * includes latestDate and the preceding 11/23 months — e.g. with
   * latestDate "2026-07", "Last year" gives the 12-month range
   * "2025-08" → "2026-07". Subtracting a full year would have
   * yielded a 13-month range ("2025-07" → "2026-07").
   *
   * In yearly mode the labels still read "Last year" / "Last 2 years".
   * The latest year (e.g. "2026") is always the most recent full
   * bucket, so:
   *   - "Last year"  -> the most recent year,   start = end = latestDate
   *   - "Last 2 years" -> the most recent 2 years, start = year-1
   *
   * The "since2013" preset jumps to the start of the full-coverage era
   * (2013-01 by default; see `FULL_COVERAGE_START_YEAR`). Pre-2013 data
   * is opportunistic samples and not cross-vendor comparable.
   */
  function computePreset(
    preset: 'year' | '2y' | 'since2013' | 'all',
  ): DateRange | null {
    if (preset === 'all') return null;

    const [yearStr, monthStr] = latestDate.split('-');
    const year = parseInt(yearStr, 10);
    const month = monthStr ? parseInt(monthStr, 10) : 12;

    let start: string;
    if (preset === 'since2013') {
      // Always start at the first month/year of the full-coverage era
      // regardless of the latest date or current granularity.
      return granularity === 'month'
        ? { start: `${FULL_COVERAGE_START_YEAR}-01`, end: latestDate }
        : { start: `${FULL_COVERAGE_START_YEAR}`, end: latestDate };
    }
    if (granularity === 'month') {
      const monthsBack = preset === 'year' ? 11 : 23;
      const totalMonths = (year * 12) + (month - 1) - monthsBack;
      const startYear = Math.floor(totalMonths / 12);
      const startMonth = (totalMonths % 12) + 1;
      start = `${startYear}-${String(startMonth).padStart(2, '0')}`;
    } else {
      const yearsBack = preset === 'year' ? 0 : 1;
      start = `${year - yearsBack}`;
    }
    return { start, end: latestDate };
  }

  /** Check if a preset is currently active. */
  function isActive(preset: 'year' | '2y' | 'since2013' | 'all'): boolean {
    if (preset === 'all') return currentRange === null;
    const target = computePreset(preset);
    if (!target) return false;
    return (
      currentRange !== null &&
      currentRange.start === target.start &&
      currentRange.end === target.end
    );
  }

  function selectPreset(preset: 'year' | '2y' | 'since2013' | 'all') {
    setDateRange(computePreset(preset));
  }

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
    title={
      granularity === 'month'
        ? `Last 12 months from ${latestDate}`
        : `Last year (${latestDate})`
    }
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
    title={
      granularity === 'month'
        ? `Last 24 months from ${latestDate}`
        : `Last 2 years (${latestDate})`
    }
  >
    Last 2 years
  </button>
  <button
    type="button"
    class="text-xs px-2 py-1 rounded transition-colors
      {isActive('since2013')
        ? 'bg-vt-accent text-vt-bg-primary font-semibold'
        : 'text-vt-text-muted hover:text-vt-text-primary hover:bg-vt-bg-tertiary'}"
    onclick={() => selectPreset('since2013')}
    aria-pressed={isActive('since2013')}
    title={`From ${FULL_COVERAGE_START_YEAR} onwards — full cross-vendor coverage`}
  >
    Since {FULL_COVERAGE_START_YEAR}
  </button>
  <button
    type="button"
    class="text-xs px-2 py-1 rounded transition-colors
      {isActive('all')
        ? 'bg-vt-accent text-vt-bg-primary font-semibold'
        : 'text-vt-text-muted hover:text-vt-text-primary hover:bg-vt-bg-tertiary'}"
    onclick={() => selectPreset('all')}
    aria-pressed={isActive('all')}
    title="Include partial-coverage era (pre-2013) — not cross-vendor comparable"
  >
    Full history
  </button>
  {#if currentRange !== null}
    <span class="text-xs text-vt-text-muted ml-1">
      ({currentRange.start} → {currentRange.end})
    </span>
  {/if}
</div>
