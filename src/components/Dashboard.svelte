<script lang="ts">
  /**
   * Dashboard — the main interactive component that wires together controls
   * and charts. This is a Svelte island hydrated on the client.
   */

  import { dashboardStore } from '@/lib/store';
  import ManufacturerFilter from './controls/ManufacturerFilter.svelte';
  import GranularityToggle from './controls/GranularityToggle.svelte';
  import DiscoveredChart from './charts/DiscoveredChart.svelte';
  import FixedChart from './charts/FixedChart.svelte';
  import PatchLagChart from './charts/PatchLagChart.svelte';
  import BacklogChart from './charts/BacklogChart.svelte';

  interface Props {
    manufacturers: Array<{ name: string; colour: string }>;
    discoveredMonth: Array<{ date: string; manufacturer: string; count: number }>;
    fixedMonth: Array<{ date: string; manufacturer: string; count: number }>;
    patchLagMonth: Array<{ date: string; manufacturer: string; medianLagDays: number; p90LagDays: number; count: number }>;
    backlogMonth: Array<{ date: string; manufacturer: string; count: number }>;
    discoveredYear: Array<{ date: string; manufacturer: string; count: number }>;
    fixedYear: Array<{ date: string; manufacturer: string; count: number }>;
    patchLagYear: Array<{ date: string; manufacturer: string; medianLagDays: number; p90LagDays: number; count: number }>;
    backlogYear: Array<{ date: string; manufacturer: string; count: number }>;
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

  // Select the right dataset based on granularity
  let discovered = $derived(granularity === 'month' ? discoveredMonth : discoveredYear);
  let fixed = $derived(granularity === 'month' ? fixedMonth : fixedYear);
  let patchLag = $derived(granularity === 'month' ? patchLagMonth : patchLagYear);
  let backlog = $derived(granularity === 'month' ? backlogMonth : backlogYear);
</script>

<div class="vt-dashboard">
  <div class="vt-controls">
    <div class="vt-controls-row">
      <ManufacturerFilter {manufacturers} />
      <GranularityToggle />
    </div>
  </div>

  <div class="vt-grid">
    <div class="vt-card">
      <div class="vt-card-title">Vulnerabilities discovered</div>
      <DiscoveredChart
        data={discovered}
        {granularity}
        {selectedManufacturers}
      />
    </div>

    <div class="vt-card">
      <div class="vt-card-title">Vulnerabilities fixed</div>
      <FixedChart
        data={fixed}
        {granularity}
        {selectedManufacturers}
      />
    </div>

    <div class="vt-card">
      <div class="vt-card-title">Time between discovery and patch</div>
      <PatchLagChart
        data={patchLag}
        {granularity}
        {selectedManufacturers}
      />
    </div>

    <div class="vt-card">
      <div class="vt-card-title">Vulnerability backlog</div>
      <BacklogChart
        data={backlog}
        {granularity}
        {selectedManufacturers}
      />
    </div>
  </div>
</div>

<style>
  .vt-dashboard {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .vt-controls {
    background-color: var(--vt-bg-secondary);
    border: 1px solid var(--vt-border);
    border-radius: var(--vt-radius);
    padding: 1rem 1.5rem;
  }

  .vt-controls-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1.5rem;
    flex-wrap: wrap;
  }
</style>
