<script lang="ts">
  /**
   * Discovered chart — stacked area showing vulnerabilities discovered over time.
   */

  import StackedAreaChart from './StackedAreaChart.svelte';
  import type { DateRange } from '@/lib/store';

  interface Props {
    data: Array<{ date: string; manufacturer: string; count: number }>;
    granularity: 'month' | 'year';
    selectedManufacturers: string[];
    /** Optional time-range filter. null = show all time. */
    dateRange?: DateRange | null;
  }

  let { data, granularity, selectedManufacturers, dateRange = null }: Props = $props();
</script>

<StackedAreaChart
  {data}
  {granularity}
  {selectedManufacturers}
  {dateRange}
  yLabel="Vulnerabilities discovered"
/>
