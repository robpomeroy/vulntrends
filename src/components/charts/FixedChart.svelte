<script lang="ts">
  /**
   * Fixed chart — stacked area showing vulnerabilities patched over time.
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
  yLabel="Vulnerabilities fixed"
/>
