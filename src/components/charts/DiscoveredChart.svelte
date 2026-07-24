<script lang="ts">
  /**
   * Discovered chart — stacked area showing vulnerabilities discovered over time.
   *
   * Thin wrapper over StackedAreaChart that adds the chart-specific
   * `yLabel`, accepts the full prop set StackedAreaChart supports
   * (including `initialDateRange` for click-through pages that want
   * the "Since 2013" default), and renders the +/–/reset zoom
   * controls above the chart for click-through pages where the
   * brush is the only other way to zoom.
   */

  import StackedAreaChart from './StackedAreaChart.svelte';
  import ZoomControls from '@/components/controls/ZoomControls.svelte';
  import type { DateRange } from '@/lib/store';

  interface Props {
    data: Array<{ date: string; manufacturer: string; count: number }>;
    granularity: 'month' | 'year';
    selectedManufacturers: string[];
    /**
     * Explicit time-range filter from the dashboard. `null` = show
     * all time; omit on click-through pages so the brush drives the
     * window via the shared store.
     */
    dateRange?: DateRange | null;
    /**
     * Initial range to seed the store with. Used by click-through
     * pages to default to "Since 2013" before the user touches the
     * brush. Only applied when `dateRange` is omitted and the store
     * hasn't already been seeded by a prior user action.
     */
    initialDateRange?: DateRange | null;
    /** Override the main chart's height in pixels. Default 260. */
    mainHeight?: number;
    /**
     * Show the +/–/reset zoom controls above the chart. The
     * dashboard already drives zoom via the brush + range selector,
     * so it suppresses this for those card layouts by passing
     * `false`. Click-through pages default to `true` because the
     * brush is otherwise the only zoom control on the page.
     */
    showZoomControls?: boolean;
  }

  let {
    data,
    granularity,
    selectedManufacturers,
    dateRange = null,
    initialDateRange = null,
    mainHeight = 260,
    showZoomControls = true,
  }: Props = $props();

  // Sorted bucket keys — drives the zoom controls' data extent
  // clamping. Recomputed when the data prop changes.
  let dataKeys = $derived([...new Set(data.map((d) => d.date))].sort());
</script>

{#if showZoomControls}
  <div class="flex items-center justify-end mb-3">
    <ZoomControls {dataKeys} resetRange={initialDateRange} />
  </div>
{/if}

<StackedAreaChart
  {data}
  {granularity}
  {selectedManufacturers}
  {dateRange}
  {initialDateRange}
  {mainHeight}
  yLabel="Vulnerabilities discovered"
/>
