<script lang="ts">
  /**
   * Discovered chart — stacked area showing vulnerabilities discovered over time.
   */

  import StackedAreaChart from './StackedAreaChart.svelte';

  interface Props {
    data: Array<{ date: string; manufacturer: string; count: number }>;
    granularity: 'month' | 'year';
    selectedManufacturers: string[];
  }

  let { data, granularity, selectedManufacturers }: Props = $props();
</script>

<StackedAreaChart
  {data}
  {granularity}
  {selectedManufacturers}
  yLabel="Vulnerabilities discovered"
/>
