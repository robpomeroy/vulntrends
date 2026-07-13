<script lang="ts">
  /**
   * Backlog chart — stacked area showing open vulnerabilities over time.
   *
   * BacklogPoint uses `openCount` rather than `count`, so we map it here
   * before passing to the shared StackedAreaChart which expects `count`.
   */

  import StackedAreaChart from './StackedAreaChart.svelte';
  import type { DateRange } from '@/lib/store';

  interface Props {
    data: Array<{ date: string; manufacturer: string; openCount: number }>;
    granularity: 'month' | 'year';
    selectedManufacturers: string[];
    /** Optional time-range filter. null = show all time. */
    dateRange?: DateRange | null;
  }

  let { data, granularity, selectedManufacturers, dateRange = null }: Props = $props();

  // Map openCount → count for the shared chart component
  let chartData = $derived(
    data.map((d) => ({
      date: d.date,
      manufacturer: d.manufacturer,
      count: d.openCount,
    })),
  );
</script>

<StackedAreaChart
  data={chartData}
  {granularity}
  {selectedManufacturers}
  {dateRange}
  yLabel="Open vulnerabilities (backlog)"
/>
