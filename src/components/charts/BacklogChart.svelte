<script lang="ts">
  /**
   * Backlog chart — stacked area showing open vulnerabilities over time.
   *
   * BacklogPoint uses `openCount` rather than `count`, so we map it
   * here before passing to the shared StackedAreaChart which expects
   * `count`.
   *
   * Thin wrapper that also accepts the full prop set StackedAreaChart
   * supports (including `initialDateRange` for click-through pages),
   * and renders the +/–/reset zoom controls above the chart.
   */

  import StackedAreaChart from './StackedAreaChart.svelte';
  import ZoomControls from '@/components/controls/ZoomControls.svelte';
  import type { DateRange } from '@/lib/store';

  interface Props {
    data: Array<{ date: string; manufacturer: string; openCount: number }>;
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
     * brush.
     */
    initialDateRange?: DateRange | null;
    /** Override the main chart's height in pixels. Default 260. */
    mainHeight?: number;
    /** Show the +/–/reset zoom controls above the chart. Default `true`. */
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

  // Map openCount → count for the shared chart component
  let chartData = $derived(
    data.map((d) => ({
      date: d.date,
      manufacturer: d.manufacturer,
      count: d.openCount,
    })),
  );

  let dataKeys = $derived([...new Set(chartData.map((d) => d.date))].sort());
</script>

{#if showZoomControls}
  <div class="flex items-center justify-end mb-3">
    <ZoomControls {dataKeys} resetRange={initialDateRange} />
  </div>
{/if}

<StackedAreaChart
  data={chartData}
  {granularity}
  {selectedManufacturers}
  {dateRange}
  {initialDateRange}
  {mainHeight}
  yLabel="Open vulnerabilities (backlog)"
/>
