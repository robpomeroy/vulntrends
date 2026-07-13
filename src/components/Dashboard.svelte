<script lang="ts">
  /**
   * Dashboard — the main interactive component that wires together controls
   * and charts. This is a Svelte island hydrated on the client.
   */

  import { dashboardStore } from '@/lib/store';
  import ManufacturerFilter from './controls/ManufacturerFilter.svelte';
  import GranularityToggle from './controls/GranularityToggle.svelte';
  import RangeSelector from './controls/RangeSelector.svelte';
  import DiscoveredChart from './charts/DiscoveredChart.svelte';
  import FixedChart from './charts/FixedChart.svelte';
  import PatchLagChart from './charts/PatchLagChart.svelte';
  import BacklogChart from './charts/BacklogChart.svelte';

  interface Props {
    manufacturers: Array<{ name: string; colour: string }>;
    discoveredMonth: Array<{ date: string; manufacturer: string; count: number }>;
    fixedMonth: Array<{ date: string; manufacturer: string; count: number }>;
    patchLagMonth: Array<{ date: string; manufacturer: string; medianLagDays: number; p90LagDays: number; knownCount: number; totalCount: number }>;
    backlogMonth: Array<{ date: string; manufacturer: string; openCount: number }>;
    discoveredYear: Array<{ date: string; manufacturer: string; count: number }>;
    fixedYear: Array<{ date: string; manufacturer: string; count: number }>;
    patchLagYear: Array<{ date: string; manufacturer: string; medianLagDays: number; p90LagDays: number; knownCount: number; totalCount: number }>;
    backlogYear: Array<{ date: string; manufacturer: string; openCount: number }>;
  }

  let {
    manufacturers,
    discoveredMonth,
    fixedMonth,
    patchLagMonth,
    backlogMonth,
    discoveredYear,
    fixedYear,
    patchLagYear,
    backlogYear,
  }: Props = $props();

  let granularity = $derived($dashboardStore.granularity);
  let selectedManufacturers = $derived($dashboardStore.selectedManufacturers);
  let dateRange = $derived($dashboardStore.dateRange);

  // Select the right dataset based on granularity
  let discovered = $derived(granularity === 'month' ? discoveredMonth : discoveredYear);
  let fixed = $derived(granularity === 'month' ? fixedMonth : fixedYear);
  let patchLag = $derived(granularity === 'month' ? patchLagMonth : patchLagYear);
  let backlog = $derived(granularity === 'month' ? backlogMonth : backlogYear);

  // Latest date in the data — used by the RangeSelector to compute presets.
  // When granularity is monthly, the latest date is "YYYY-MM"; when yearly,
  // it's "YYYY". The RangeSelector handles both formats.
  let latestDate = $derived.by(() => {
    const all = [...discovered, ...fixed, ...patchLag, ...backlog];
    if (all.length === 0) return granularity === 'year' ? '2025' : '2025-01';
    return all.reduce((max, d) => (d.date > max ? d.date : max), all[0].date);
  });
</script>

<div class="flex flex-col gap-6">
  <div class="bg-vt-bg-secondary border border-vt-border rounded-lg px-6 py-4">
    <div class="flex items-start justify-between gap-6 flex-wrap">
      <ManufacturerFilter {manufacturers} />
      <div class="flex items-center gap-6 flex-wrap">
        <RangeSelector {latestDate} {granularity} />
        <GranularityToggle />
      </div>
    </div>
  </div>

  <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
    <div class="bg-vt-bg-secondary border border-vt-border rounded-lg p-6">
      <div class="text-sm font-semibold uppercase tracking-wide text-vt-text-muted mb-4">Vulnerabilities discovered</div>
      <DiscoveredChart
        data={discovered}
        {granularity}
        {selectedManufacturers}
        {dateRange}
      />
    </div>

    <div class="bg-vt-bg-secondary border border-vt-border rounded-lg p-6">
      <div class="text-sm font-semibold uppercase tracking-wide text-vt-text-muted mb-4">Vulnerabilities fixed</div>
      <FixedChart
        data={fixed}
        {granularity}
        {selectedManufacturers}
        {dateRange}
      />
    </div>

    <div class="bg-vt-bg-secondary border border-vt-border rounded-lg p-6">
      <div class="text-sm font-semibold uppercase tracking-wide text-vt-text-muted mb-4">Time between discovery and patch</div>
      <PatchLagChart
        data={patchLag}
        {granularity}
        {selectedManufacturers}
        {dateRange}
      />
    </div>

    <div class="bg-vt-bg-secondary border border-vt-border rounded-lg p-6">
      <div class="text-sm font-semibold uppercase tracking-wide text-vt-text-muted mb-4">Vulnerability backlog</div>
      <BacklogChart
        data={backlog}
        {granularity}
        {selectedManufacturers}
        {dateRange}
      />
    </div>
  </div>
</div>
