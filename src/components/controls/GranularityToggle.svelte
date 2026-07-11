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

<div class="inline-flex border border-vt-border rounded-sm overflow-hidden" role="group" aria-label="Time granularity">
  {#each options as opt (opt.value)}
    <button
      type="button"
      class="py-1.5 px-3.5 text-sm cursor-pointer transition-all border-none
        {current === opt.value
          ? 'bg-vt-accent text-vt-bg-primary font-semibold hover:bg-vt-accent hover:text-vt-bg-primary'
          : 'bg-transparent text-vt-text-muted hover:text-vt-text-primary hover:bg-vt-bg-tertiary'}"
      on:click={() => setGranularity(opt.value)}
      aria-pressed={current === opt.value}
    >
      {opt.label}
    </button>
  {/each}
</div>
