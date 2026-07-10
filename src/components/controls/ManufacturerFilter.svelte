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

<div class="vt-manufacturer-filter" role="group" aria-label="Filter by manufacturer">
  <div class="vt-filter-header">
    <span class="vt-filter-label">Manufacturers</span>
    <button
      type="button"
      class="vt-filter-action"
      onclick={selectAllManufacturers}
      aria-label="Select all manufacturers"
    >
      {allSelected ? 'All selected' : 'Select all'}
    </button>
  </div>
  <div class="vt-chips">
    {#each manufacturers as m (m.name)}
      <button
        type="button"
        class="vt-chip"
        class:vt-chip-selected={allSelected || selectedSet.has(m.name)}
        onclick={() => toggleManufacturer(m.name)}
        aria-pressed={allSelected || selectedSet.has(m.name)}
      >
        <span class="vt-chip-dot" style="background-color: {m.colour}"></span>
        <span class="vt-chip-label">{m.name}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .vt-manufacturer-filter {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .vt-filter-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .vt-filter-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vt-text-muted);
  }

  .vt-filter-action {
    background: none;
    border: none;
    color: var(--vt-accent);
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0;
  }

  .vt-filter-action:hover {
    color: #7dd3fc;
  }

  .vt-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .vt-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.625rem;
    border: 1px solid var(--vt-border);
    border-radius: 9999px;
    background: transparent;
    color: var(--vt-text-secondary);
    font-size: 0.8125rem;
    cursor: pointer;
    transition: all var(--vt-transition);
  }

  .vt-chip:hover {
    border-color: var(--vt-accent);
    color: var(--vt-text-primary);
  }

  .vt-chip-selected {
    background-color: var(--vt-bg-tertiary);
    border-color: var(--vt-accent);
    color: var(--vt-text-primary);
  }

  .vt-chip-dot {
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
