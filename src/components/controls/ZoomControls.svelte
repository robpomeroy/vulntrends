<script lang="ts">
  /**
   * Zoom controls — `+` / `–` buttons that shrink or grow the
   * active date range around its midpoint (or, with no current
   * selection, around the middle of the dataset).
   *
   * Wired through the same `dashboardStore` as the chart on the
   * page, so pressing a button updates the store, the chart's
   * reactive `effectiveDateRange` recomputes, and the chart
   * re-renders — exactly like a brush drag.
   *
   * The math lives in `lib/d3/zoom.ts` so it can be unit-tested
   * without booting Svelte. This component is just the buttons,
   * aria, and styling.
   *
   * Why we clamp to existing bucket keys rather than time deltas:
   * the data ticks at month or year granularity, so picking an
   * arbitrary date would land on a bucket boundary that may not
   * exist in the dataset (e.g. asking for "2014-03-15 12:00" on a
   * monthly chart). Indexing into the sorted bucket array sidesteps
   * the timezone / leap-year / mid-month-edge cases that bit us
   * with the brush's `parseBucketEnd` helper.
   */

  import {
    dashboardStore,
    setDateRange,
    type DateRange,
    type Granularity,
  } from '@/lib/store';
  import { computeZoomedRange } from '@/lib/d3/zoom';

  interface Props {
    /**
     * Sorted ascending list of every bucket key in the data (e.g.
     * ["1996-01", ..., "2025-12"] for monthly). The buttons clamp
     * their results to this list so the zoom never lands outside
     * the data and the brush cannot be desynchronised from the
     * rendered chart.
     */
    dataKeys: string[];
    /**
     * Optional initial range used for the "Reset" button. When
     * omitted, Reset clears the range entirely (matches the brush's
     * "clear selection = all time" behaviour).
     */
    resetRange?: DateRange | null;
    /** Compact layout for tight dashboard card headers. */
    compact?: boolean;
  }

  let { dataKeys, resetRange, compact = false }: Props = $props();

  /**
   * Read the active range + granularity straight from the store.
   * This is the same store the brush and the chart subscribe to,
   * so a button click propagates naturally.
   *
   * `granularity` is used to keep the bucket formatting consistent
   * with the chart's x-axis. The math in `computeZoomedRange`
   * doesn't actually need it (the bucket keys carry the format
   * with them), but keeping the prop threaded through means future
   * enhancements — e.g. "step" controls that snap to month/year
   * boundaries — have the information available.
   */
  let activeRange = $derived($dashboardStore.dateRange);
  let granularity: Granularity = $derived($dashboardStore.granularity);

  /**
   * Whether the `+` (zoom-in) button is still useful. We disable
   * it once the active range already covers the minimum viable
   * slice (≤ 2 buckets), so users get tactile feedback that
   * they've hit the floor rather than a silent no-op.
   */
  let canZoomIn = $derived.by(() => {
    if (activeRange == null) return true;
    const startIdx = dataKeys.indexOf(activeRange.start);
    const endIdx = dataKeys.indexOf(activeRange.end);
    if (startIdx < 0 || endIdx < 0) return true;
    return endIdx - startIdx + 1 > 2;
  });

  function applyRange(range: DateRange | null): void {
    /**
     * Single funnel for every store update this component makes.
     * Keeps the Svelte 5 reactivity boundary obvious and gives a
     * single place to add logging / instrumentation if we ever
     * want to see how often users actually hit the buttons.
     *
     * Svelte stores only fire subscribers when the value changes
     * (identity-equality), but we still want explicit equality
     * here for two reasons:
     *  1. It documents intent — "if we'd produce the same value,
     *     do nothing".
     *  2. It guards against Svelte 5 derived-effect loops in
     *     pathological cases (e.g. two buttons racing).
     */
    const current = $dashboardStore.dateRange;
    if (range == null && current == null) return;
    if (range && current && range.start === current.start && range.end === current.end) return;
    setDateRange(range);
  }

  function zoomIn(): void {
    applyRange(computeZoomedRange(activeRange, dataKeys, 0.5, granularity));
  }

  function zoomOut(): void {
    applyRange(computeZoomedRange(activeRange, dataKeys, 2, granularity));
  }

  function reset(): void {
    applyRange(resetRange ?? null);
  }
</script>

<div
  class={[
    'inline-flex items-center gap-1 rounded-md border border-vt-border bg-vt-bg-primary',
    compact ? 'text-xs' : 'text-sm',
  ]}
  role="group"
  aria-label="Zoom controls"
>
  <button
    type="button"
    onclick={zoomOut}
    aria-label="Zoom out (widen the visible date range)"
    title="Zoom out"
    class="px-2 py-1 text-vt-text-muted hover:text-vt-accent hover:bg-vt-bg-secondary rounded-l-md focus:outline-none focus:ring-1 focus:ring-vt-accent"
  >
    <span aria-hidden="true">−</span>
  </button>
  <button
    type="button"
    onclick={zoomIn}
    aria-label="Zoom in (narrow the visible date range)"
    title="Zoom in"
    disabled={!canZoomIn}
    class={[
      'px-2 py-1 hover:text-vt-accent hover:bg-vt-bg-secondary focus:outline-none focus:ring-1 focus:ring-vt-accent',
      canZoomIn ? 'text-vt-text-muted' : 'text-vt-text-muted opacity-40 cursor-not-allowed',
    ]}
  >
    <span aria-hidden="true">+</span>
  </button>
  <button
    type="button"
    onclick={reset}
    aria-label="Reset zoom (show full data range or initial range)"
    title="Reset zoom"
    class="px-2 py-1 text-vt-text-muted hover:text-vt-accent hover:bg-vt-bg-secondary rounded-r-md border-l border-vt-border focus:outline-none focus:ring-1 focus:ring-vt-accent"
  >
    <span aria-hidden="true">⤾</span>
  </button>
</div>
