<script lang="ts">
  /**
   * Patch lag chart — line chart with median + p90 bands.
   * Shows the time between vulnerability discovery and patch release.
   */

  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import { THEME, getColour } from '@/lib/d3/theme';
  import { createTooltip, type Tooltip } from '@/lib/d3/tooltip';
  import {
    BRUSH_LAYOUT,
    BRUSH_MARGIN_RIGHT,
    brushInnerHeight,
    brushY,
    renderBrushStrip,
  } from '@/lib/d3/brush';
  import {
    dashboardStore,
    inDateRange,
    type DateRange,
  } from '@/lib/store';
  import ZoomControls from '@/components/controls/ZoomControls.svelte';

  interface Props {
    data: Array<{
      date: string;
      manufacturer: string;
      medianLagDays: number;
      p90LagDays: number;
      /**
       * Records in this bucket with a real (independent discovery +
       * patch) lag — i.e. `discoveredDate !== patchedDate` and
       * `discoveredDate` is known. Zero means the bucket has no
       * measurable lag; the chart treats those as gaps rather than
       * plotting 0. The aggregator still emits the point (with
       * median/p90 = 0) so the confidence badge can use totalCount.
       */
      knownCount: number;
      /**
       * All records in this bucket with a patch date (including those
       * with no known discovery date). Used as the denominator for
       * the data confidence indicator: knownCount / totalCount = %
       * of fixed records that have a known patch lag.
       */
      totalCount: number;
    }>;
    granularity: 'month' | 'year';
    selectedManufacturers: string[];
    /** Optional time-range filter. null = show all time. */
    dateRange?: DateRange | null;
    /**
     * Initial range to seed the store with on mount, used by
     * click-through pages to default to "Since 2013" before the user
     * touches the brush. Only applied when the store's current
     * dateRange is null. Ignored if `dateRange` is also passed.
     */
    initialDateRange?: DateRange | null;
    /**
     * Override the main chart's height in pixels. Default 260.
     * Larger values are used by the click-through pages for a more
     * readable full-width view.
     */
    mainHeight?: number;
    /**
     * If true, hide the in-card "hide low confidence" toggle (used
     * by the click-through pages where it's redundant with the
     * manufacturer filter).
     */
    showConfidenceToggle?: boolean;
    /**
     * Show the +/–/reset zoom controls above the chart. Dashboard
     * card layouts drive zoom via the range selector + brush, so
     * they pass `false`. Click-through pages default to `true`
     * because the brush is otherwise the only zoom control.
     */
    showZoomControls?: boolean;
  }

  let {
    data,
    granularity,
    selectedManufacturers,
    // `undefined` default (not `null`) — see the matching note on
    // StackedAreaChart. The three-way distinction lets click-through
    // pages omit the prop entirely and let the shared store drive
    // the brush, while the dashboard passes a real dateRange and
    // individual callers can still force "all time" by passing null.
    dateRange = undefined as DateRange | null | undefined,
    initialDateRange = null,
    mainHeight: mainHeightProp = 260,
    showConfidenceToggle = true,
    showZoomControls = true,
  }: Props = $props();

  // Read from the shared store so the brush on a click-through page
  // (where no dateRange prop is passed) updates the visible window.
  // On the dashboard, Dashboard.svelte already passes the store-derived
  // value via the dateRange prop, so effectiveDateRange is identical.
  //
  // `dateRange == null` (loose) catches both `undefined` and `null`,
  // so even when a Svelte wrapper passes through a null `dateRange`
  // from a parent that didn't specify one, we still fall through to
  // the store. This matches StackedAreaChart's behaviour.
  // When `initialDateRange` is set, it's used as the seed for the
  // store-derived path so the chart has a sensible starting range
  // even before the user touches the brush.
  let storeDateRange = $derived($dashboardStore.dateRange);
  let effectiveDateRange = $derived(
    dateRange == null
      ? (storeDateRange ?? initialDateRange)
      : dateRange,
  );

  let container: HTMLDivElement;
  let tooltip: Tooltip;
  let svg: SVGSVGElement;

  // When true, hide manufacturers whose data confidence is below the
  // threshold. Default off — the confidence badge + footnote is enough
  // context, but users can opt into a stricter view.
  let hideLowConfidence = $state(false);
  // Minimum fraction of records that must be known for a manufacturer
  // to be shown when hideLowConfidence is true.
  const CONFIDENCE_THRESHOLD = 0.5;

  // Per-manufacturer data confidence — used both for the badge and for
  // the hideLowConfidence filter.
  let confidenceByMfr = $derived.by(() => {
    const byMfr = new Map<string, { known: number; total: number }>();
    for (const d of data) {
      const cur = byMfr.get(d.manufacturer) ?? { known: 0, total: 0 };
      cur.known += d.knownCount;
      cur.total += d.totalCount;
      byMfr.set(d.manufacturer, cur);
    }
    return byMfr;
  });

  /**
   * Manufacturer + confidence filtered data, but NOT filtered by
   * dateRange. Used for the brush strip so the user can always see
   * and brush the full range of data that's currently in view.
   */
  let mfrFilteredData = $derived(
    data
      .filter((d) =>
        selectedManufacturers.length === 0 ||
        selectedManufacturers.includes(d.manufacturer),
      )
      .filter((d) => {
        if (!hideLowConfidence) return true;
        const conf = confidenceByMfr.get(d.manufacturer);
        if (!conf || conf.total === 0) return false;
        return conf.known / conf.total >= CONFIDENCE_THRESHOLD;
      }),
  );

  // Sorted ascending bucket keys for the zoom controls. Uses the
  // raw `data` rather than `mfrFilteredData` so the clamp stays
  // consistent with the brush strip's data extent regardless of
  // any active filter (manufacturers / confidence) — the brush
  // renders the full data range for the same reason.
  let dataKeys = $derived([...new Set(data.map((d) => d.date))].sort());

  let filteredData = $derived(inDateRange(mfrFilteredData, effectiveDateRange));

  // Data confidence: fraction of records in the current view that have
  // a known patch lag (i.e. both a discovery and a patch date). Shown
  // as a badge above the chart so users know how much of the data is
  // measured vs inferred.
  let confidence = $derived.by(() => {
    let known = 0;
    let total = 0;
    for (const d of filteredData) {
      known += d.knownCount;
      total += d.totalCount;
    }
    if (total === 0) return { known: 0, total: 0, ratio: 0 };
    return { known, total, ratio: known / total };
  });
  // Confidence label colour: green if high, amber if medium, red if low.
  let confidenceColor = $derived(
    confidence.ratio >= 0.7
      ? 'text-green-400'
      : confidence.ratio >= 0.3
        ? 'text-amber-400'
        : 'text-red-400',
  );
  let confidenceLabel = $derived(
    confidence.total === 0
      ? 'No data'
      : confidence.ratio >= 0.7
        ? 'High confidence'
        : confidence.ratio >= 0.3
          ? 'Medium confidence'
          : 'Low confidence',
  );

  $effect(() => {
    if (!svg || !filteredData) return;
    renderChart();
  });

  function renderChart() {
    if (!svg) return;
    const width = container.clientWidth;

    // Layout: main chart (260px) + gap (BRUSH_LAYOUT.gap) + brush strip
    // (BRUSH_LAYOUT.stripHeight). Constants live in lib/d3/brush so
    // every chart renders the strip identically.
    const mainHeight = mainHeightProp;
    const height = mainHeight + BRUSH_LAYOUT.gap + BRUSH_LAYOUT.stripHeight;
    // margin.left is wider than usual so 4–5 digit y-axis tick labels
    // (e.g. "2,500" on the patch lag chart) don't overlap the rotated
    // y-axis label. 72px is enough for ~28px of tick label + 44px of
    // breathing room for the rotated chart title.
    const margin = { top: 16, right: 16, bottom: 24, left: 72 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = mainHeight - margin.top - margin.bottom;
    const stripWidth = width - margin.left - BRUSH_MARGIN_RIGHT;
    const stripHeight = brushInnerHeight();
    const stripX = margin.left;
    const stripY = brushY(mainHeight);

    d3.select(svg).selectAll('*').remove();
    d3.select(svg).attr('width', width).attr('height', height);

    if (filteredData.length === 0) {
      d3.select(svg)
        .append('text')
        .attr('x', width / 2)
        .attr('y', mainHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', THEME.textMuted)
        .text('No patch-lag data available');
    } else {
      renderMainChart(innerWidth, innerHeight, margin);
    }

    // Build the brush data: total records per date across the
    // manufacturer-filtered data (NOT filtered by dateRange, so the
    // brush always shows the full data range). The minimap value is
    // totalCount (records with a patch date) — a better measure of
    // data volume than median lag for understanding the distribution.
    const brushDataMap = new Map<string, number>();
    for (const d of mfrFilteredData) {
      brushDataMap.set(d.date, (brushDataMap.get(d.date) ?? 0) + d.totalCount);
    }
    const brushData = [...brushDataMap.entries()]
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));

    renderBrushStrip({
      svg,
      innerWidth: stripWidth,
      innerHeight: stripHeight,
      xOffset: stripX,
      yOffset: stripY,
      data: brushData,
      granularity,
      dateRange: effectiveDateRange,
    });
  }

  function renderMainChart(
    innerWidth: number,
    innerHeight: number,
    margin: { top: number; right: number; bottom: number; left: number },
  ) {
    const manufacturers = [...new Set(filteredData.map((d) => d.manufacturer))];
    const parseDate =
      granularity === 'month' ? d3.timeParse('%Y-%m') : d3.timeParse('%Y');

    // Group by manufacturer
    const byManufacturer = new Map<string, typeof filteredData>();
    for (const d of filteredData) {
      if (!byManufacturer.has(d.manufacturer)) {
        byManufacturer.set(d.manufacturer, []);
      }
      byManufacturer.get(d.manufacturer)!.push(d);
    }

    const grouped = [...byManufacturer.entries()].map(([manufacturer, values]) => ({
      manufacturer,
      values: values
        .map((d) => ({ ...d, _date: parseDate(d.date) as Date }))
        .sort((a, b) => a._date.getTime() - b._date.getTime()),
    }));

    // Scales. The y-scale only considers buckets with a real lag
    // measurement (knownCount > 0); the aggregator's 0 placeholders
    // for unknown buckets would otherwise compress the y-axis and
    // make the real signal look like a thin sliver near the top.
    const allDates = grouped.flatMap((g) => g.values.map((v) => v._date));
    const x = d3
      .scaleTime()
      .domain(d3.extent(allDates) as [Date, Date])
      .range([0, innerWidth]);

    const realLags = filteredData
      .filter((d) => d.knownCount > 0)
      .flatMap((d) => [d.medianLagDays, d.p90LagDays]);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(realLags) ?? 0])
      .range([innerHeight, 0])
      .nice();

    const colour = d3
      .scaleOrdinal<string, string>()
      .domain(manufacturers)
      .range(manufacturers.map(getColour));

    // Line generators. The `defined()` accessor tells d3 to break the
    // line/area when a point has no known (independent discovery +
    // patch) lag — the aggregator emits medianLagDays: 0 / p90LagDays: 0
    // as placeholders for those buckets, but plotting 0 would visually
    // read as "0-day patch lag" and undo the proxy-data fix. With
    // defined() returning false, d3 inserts a NaN gap instead.
    const medianLine = d3
      .line<{ _date: Date; medianLagDays: number; knownCount: number }>()
      .defined((d) => d.knownCount > 0)
      .x((d) => x(d._date))
      .y((d) => y(d.medianLagDays))
      .curve(d3.curveMonotoneX);

    const p90Area = d3
      .area<{ _date: Date; p90LagDays: number; medianLagDays: number; knownCount: number }>()
      .defined((d) => d.knownCount > 0)
      .x((d) => x(d._date))
      .y0((d) => y(d.medianLagDays))
      .y1((d) => y(d.p90LagDays))
      .curve(d3.curveMonotoneX);

    const g = d3
      .select(svg)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Grid
    g.append('g')
      .attr('class', 'grid')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(granularity === 'month' ? 6 : 10)
          .tickSize(-innerHeight)
          .tickFormat(() => '' as never),
      );

    // P90 bands (filled areas between median and p90)
    grouped.forEach((grp) => {
      g.append('path')
        .datum(grp.values)
        .attr('fill', colour(grp.manufacturer))
        .attr('fill-opacity', 0.15)
        .attr('d', p90Area as never);
    });

    // Median lines
    grouped.forEach((grp) => {
      g.append('path')
        .datum(grp.values)
        .attr('fill', 'none')
        .attr('stroke', colour(grp.manufacturer))
        .attr('stroke-width', 2)
        .attr('d', medianLine as never);
    });

    // Axes
    const formatTick =
      granularity === 'month' ? d3.timeFormat('%b %Y') : d3.timeFormat('%Y');

    g.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(granularity === 'month' ? 6 : 10)
          .tickFormat(formatTick as never),
      );

    g.append('g')
      .attr('class', 'axis')
      .call(d3.axisLeft(y).ticks(6));

    // Y axis label. Positioned at x = -52 (was -44) so 4–5 digit tick
    // labels (e.g. "2,500") don't crowd the rotated chart title.
    // We bumped margin.left to 72 to give this label room alongside
    // the longest tick values.
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerHeight / 2)
      .attr('y', -52)
      .attr('text-anchor', 'middle')
      .attr('fill', THEME.textMuted)
      .style('font-size', '0.75rem')
      .text('Days to patch');

    // Hover interaction
    const focus = g.append('g').style('opacity', 0);
    focus
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', THEME.textMuted)
      .attr('stroke-dasharray', '3 3')
      .attr('opacity', 0.5);

    const overlay = g
      .append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'none')
      .attr('pointer-events', 'all');

    overlay.on('mousemove', (event) => {
      const [mx] = d3.pointer(event);
      const rawDate = x.invert(mx);

      // Find nearest data point per manufacturer. The tooltip shows
      // both the lag stats (median/p90) and the sample size
      // (knownCount / totalCount) so the user can judge how much
      // weight the median deserves.
      const candidates: Array<{
        date: Date;
        m: string;
        median: number;
        p90: number;
        knownCount: number;
        totalCount: number;
      }> = [];
      for (const grp of grouped) {
        const bisect = d3.bisector((d: { _date: Date }) => d._date).left;
        const idx = bisect(grp.values, rawDate, 1);
        const d0 = grp.values[idx - 1];
        const d1 = grp.values[idx];
        if (!d0 && !d1) continue;
        const d =
          !d1 || rawDate.getTime() - d0._date.getTime() < d1._date.getTime() - rawDate.getTime()
            ? d0
            : d1;
        candidates.push({
          date: d._date,
          m: grp.manufacturer,
          median: d.medianLagDays,
          p90: d.p90LagDays,
          knownCount: d.knownCount,
          totalCount: d.totalCount,
        });
      }

      if (candidates.length === 0) return;

      // Snap to the bucket closest to the raw mouse position, not
      // arbitrary `candidates[0]`. Different manufacturers may have
      // data in different buckets, so we pick the single closest one
      // and only show values for manufacturers that have a data point
      // in that exact bucket.
      const snapDate = candidates.reduce((closest, c) =>
        Math.abs(c.date.getTime() - rawDate.getTime()) <
        Math.abs(closest.date.getTime() - rawDate.getTime())
          ? c
          : closest,
      ).date;
      const snapTime = snapDate.getTime();
      const rows = candidates.filter((c) => c.date.getTime() === snapTime);

      focus.attr('transform', `translate(${x(snapDate)},0)`);
      focus.style('opacity', 1);

      rows.sort((a, b) => a.median - b.median);
      tooltip.show(
        event,
        formatTick(snapDate),
        rows.map((r) => ({
          colour: getColour(r.m),
          label: r.m,
          value:
            r.knownCount > 0
              ? `median ${r.median}d, p90 ${r.p90}d (${r.knownCount} known / ${r.totalCount} patched)`
              : `no known lag (${r.totalCount} patched)`,
        })),
      );
    });

    overlay.on('mouseleave', () => {
      focus.style('opacity', 0);
      tooltip.hide();
    });
  }

  onMount(() => {
    tooltip = createTooltip();
    renderChart();
    const resizeObserver = new ResizeObserver(() => renderChart());
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  });

  onDestroy(() => {
    tooltip?.destroy();
  });
</script>

<div class="vt-chart" bind:this={container}>
  {#if showZoomControls}
    <div class="flex items-center justify-end mb-3">
      <ZoomControls {dataKeys} resetRange={initialDateRange} />
    </div>
  {/if}
  <svg bind:this={svg}></svg>
  <!--
    Footer row (below the brush strip): data confidence badge +
    "hide low confidence" toggle. Putting both controls under the
    brush means the chart drawing isn't crowded by chrome, and
    users see the controls in the order they affect the chart
    (chart -> brush -> confidence filter).
  -->
  <div class="flex items-center justify-between mt-3 flex-wrap gap-2">
    {#if confidence.total > 0}
      <div
        class="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded
          bg-vt-bg-tertiary/80 backdrop-blur-sm border border-vt-border"
        title="{confidence.known} of {confidence.total} records ({Math.round(confidence.ratio * 100)}%) have both a discovery date and a patch date. The rest have a patch date but no known discovery date, so their lag cannot be calculated."
      >
        <span
          class="inline-block w-1.5 h-1.5 rounded-full {confidenceColor} bg-current"
          aria-hidden="true"
        ></span>
        <span class="{confidenceColor} font-medium">
          {confidenceLabel}
        </span>
        <span class="text-vt-text-muted">
          ({Math.round(confidence.ratio * 100)}%)
        </span>
      </div>
    {:else}
      <div></div>
    {/if}
    <label class="flex items-center gap-1.5 text-xs text-vt-text-muted cursor-pointer">
      <input
        type="checkbox"
        bind:checked={hideLowConfidence}
        class="rounded border-vt-border bg-vt-bg-tertiary text-vt-accent
          focus:ring-vt-accent focus:ring-offset-vt-bg-primary"
      />
      <span>Hide low-confidence manufacturers (&lt;{Math.round(CONFIDENCE_THRESHOLD * 100)}%)</span>
    </label>
  </div>
  <!--
    Footnote explaining the data limitation. Most vendor advisories only
    publish a patch date, not a separate discovery date, so patch lag
    can only be calculated for CVEs where NVD published a CVE ID
    (giving us a discovery proxy) before the vendor's patch advisory.
  -->
  <p class="text-xs text-vt-text-muted mt-2">
    Patch lag is calculated from records where both a discovery date
    and a patch date are available. Most vendor advisories only publish
    a patch date — the chart only shows the subset of CVEs with full
    data, which can over-represent vendors that publish more detail.
    <a href="/about" class="text-vt-accent hover:underline">Methodology</a>
  </p>
</div>
