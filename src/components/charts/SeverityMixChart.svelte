<script lang="ts">
  /**
   * Severity-mix chart — stacked area of CVSS severity buckets over
   * time. Each point in the input data is one (date, severity) row;
   * the chart groups by date and stacks the severities.
   *
   * The chart reuses StackedAreaChart by mapping each severity
   * bucket to a pseudo-manufacturer. Renders the +/–/reset zoom
   * controls above the chart so click-through pages have a
   * discoverable zoom path in addition to the brush.
   */

  import StackedAreaChart from './StackedAreaChart.svelte';
  import ZoomControls from '@/components/controls/ZoomControls.svelte';
  import type { DateRange } from '@/lib/store';

  interface Props {
    data: Array<{ date: string; severity: 'critical' | 'high' | 'medium' | 'low'; count: number }>;
    granularity: 'month' | 'year';
    selectedManufacturers: string[];
    /** Optional time-range filter. null = show all time. */
    dateRange?: DateRange | null;
    /** Initial range to seed the store with on click-through pages. */
    initialDateRange?: DateRange | null;
    /** Main chart height in pixels. Default 260. */
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

  // Project severity records into the (date, manufacturer, count)
  // shape StackedAreaChart expects. Each severity bucket becomes a
  // pseudo-manufacturer (the colours come from getColour's fallback
  // chain — fine for now).
  let chartData = $derived(
    data.map((d) => ({
      date: d.date,
      manufacturer: d.severity,
      count: d.count,
    })),
  );

  let dataKeys = $derived([...new Set(chartData.map((d) => d.date))].sort());

  // ManufacturerFilter is not used for severity-mix (no manufacturer
  // concept), so selectedManufacturers is always treated as "all".
  void selectedManufacturers;
</script>

{#if showZoomControls}
  <div class="flex items-center justify-end mb-3">
    <ZoomControls {dataKeys} resetRange={initialDateRange} />
  </div>
{/if}

<StackedAreaChart
  data={chartData}
  {granularity}
  selectedManufacturers={[]}
  {dateRange}
  {initialDateRange}
  {mainHeight}
  yLabel="Vulnerabilities by severity"
/>
