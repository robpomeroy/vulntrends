<script lang="ts">
  /**
   * Manufacturer filter — multi-select chips with manufacturer colours.
   * Empty selection means "show all".
   */

  import { dashboardStore, toggleManufacturer, selectAllManufacturers } from '@/lib/store';

  interface Props {
    manufacturers: Array<{ name: string; colour: string }>;
  }

  let { manufacturers }: Props = $props();

  let selectedSet = $derived(new Set($dashboardStore.selectedManufacturers));
  let allSelected = $derived($dashboardStore.selectedManufacturers.length === 0);
</script>

<div class="flex flex-col gap-2" role="group" aria-label="Filter by manufacturer">
  <div class="flex items-center justify-between">
    <span class="text-xs font-semibold uppercase tracking-wide text-vt-text-muted">Manufacturers</span>
    <button
      type="button"
      class="text-xs text-vt-accent hover:text-sky-300 bg-transparent border-none cursor-pointer p-0"
      on:click={selectAllManufacturers}
      aria-label="Select all manufacturers"
    >
      {allSelected ? 'All selected' : 'Select all'}
    </button>
  </div>
  <div class="flex flex-wrap gap-2">
    {#each manufacturers as m (m.name)}
      <button
        type="button"
        class="inline-flex items-center gap-1.5 py-1 px-2.5 border rounded-full text-sm cursor-pointer transition-all
          {allSelected || selectedSet.has(m.name)
            ? 'bg-vt-bg-tertiary border-vt-accent text-vt-text-primary'
            : 'bg-transparent border-vt-border text-vt-text-secondary hover:border-vt-accent hover:text-vt-text-primary'}"
        on:click={() => toggleManufacturer(m.name)}
        aria-pressed={allSelected || selectedSet.has(m.name)}
      >
        <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: {m.colour}"></span>
        <span>{m.name}</span>
      </button>
    {/each}
  </div>
</div>
