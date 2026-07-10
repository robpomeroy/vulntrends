<script lang="ts">
  /**
   * Granularity toggle — segmented control for Month / Year.
   */

  import { dashboardStore, setGranularity, type Granularity } from '@/lib/store';

  const options: Array<{ value: Granularity; label: string }> = [
    { value: 'month', label: 'Month' },
    { value: 'year', label: 'Year' },
  ];

  let current = $derived($dashboardStore.granularity);
</script>

<div class="vt-granularity-toggle" role="group" aria-label="Time granularity">
  {#each options as opt (opt.value)}
    <button
      type="button"
      class="vt-toggle-btn"
      class:vt-toggle-btn-active={current === opt.value}
      onclick={() => setGranularity(opt.value)}
      aria-pressed={current === opt.value}
    >
      {opt.label}
    </button>
  {/each}
</div>

<style>
  .vt-granularity-toggle {
    display: inline-flex;
    border: 1px solid var(--vt-border);
    border-radius: var(--vt-radius-sm);
    overflow: hidden;
  }

  .vt-toggle-btn {
    padding: 0.375rem 0.875rem;
    background: transparent;
    border: none;
    color: var(--vt-text-muted);
    font-size: 0.8125rem;
    cursor: pointer;
    transition: all var(--vt-transition);
  }

  .vt-toggle-btn:hover {
    color: var(--vt-text-primary);
    background-color: var(--vt-bg-tertiary);
  }

  .vt-toggle-btn-active {
    background-color: var(--vt-accent);
    color: var(--vt-bg-primary);
    font-weight: 600;
  }

  .vt-toggle-btn-active:hover {
    background-color: var(--vt-accent);
    color: var(--vt-bg-primary);
  }
</style>
