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
  import { inDateRange, type DateRange } from '@/lib/store';

  interface Props {
    data: Array<{
      date: string;
      manufacturer: string;
      medianLagDays: number;
      p90LagDays: number;
      /**
       * Records with a known (non-zero) patch lag — i.e. where both
       * a discovery and a patch date were available. Used as the
       * denominator for the median/p90 calculation.
       */
      knownCount: number;
      /**
       * All records in this bucket with a patch date (including those
       * with no known discovery date). Used for the data confidence
       * indicator: knownCount / totalCount = % records with full data.
       */
      totalCount: number;
    }>;
    granularity: 'month' | 'year';
    selectedManufacturers: string[];
    /** Optional time-range filter. null = show all time. */
    dateRange?: import('@/lib/store').DateRange | null;
  }

  let { data, granularity, selectedManufacturers, dateRange = null }: Props = $props();

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

  let filteredData = $derived(inDateRange(mfrFilteredData, dateRange));

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
    const mainHeight = 260;
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
      dateRange,
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

    // Scales
    const allDates = grouped.flatMap((g) => g.values.map((v) => v._date));
    const x = d3
      .scaleTime()
      .domain(d3.extent(allDates) as [Date, Date])
      .range([0, innerWidth]);

    const allLags = filteredData.map((d) => d.p90LagDays);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(allLags) as number])
      .range([innerHeight, 0])
      .nice();

    const colour = d3
      .scaleOrdinal<string, string>()
      .domain(manufacturers)
      .range(manufacturers.map(getColour));

    // Line generators
    const medianLine = d3
      .line<{ _date: Date; medianLagDays: number }>()
      .x((d) => x(d._date))
      .y((d) => y(d.medianLagDays))
      .curve(d3.curveMonotoneX);

    const p90Area = d3
      .area<{ _date: Date; p90LagDays: number; medianLagDays: number }>()
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

      // Find nearest data point per manufacturer
      const candidates: Array<{ date: Date; m: string; median: number; p90: number; count: number }> = [];
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
          count: d.count,
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
          value: `median ${r.median}d, p90 ${r.p90}d (${r.count})`,
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
