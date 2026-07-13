<script lang="ts">
  /**
   * Stacked area chart — used for "discovered", "fixed", and "backlog"
   * panels on the dashboard. Each panel stacks per-manufacturer counts
   * over time.
   *
   * Also renders a D3 brush strip below the main chart for free-form
   * time-range selection. The brush logic is shared with PatchLagChart
   * via `lib/d3/brush` so the two stay in sync.
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
    data: Array<{ date: string; manufacturer: string; count: number }>;
    yLabel: string;
    granularity: 'month' | 'year';
    selectedManufacturers: string[];
    /** Optional time-range filter. null = show all time. */
    dateRange?: DateRange | null;
  }

  let { data, yLabel, granularity, selectedManufacturers, dateRange = null }: Props = $props();

  let container: HTMLDivElement;
  let tooltip: Tooltip;
  let svg: SVGSVGElement;

  /**
   * Full time range of the data (before any dateRange filter). Used for
   * the brush strip so the user can always see and brush the full range.
   * The brush can only select within this range.
   */
  let fullData = $derived(
    selectedManufacturers.length === 0
      ? data
      : data.filter((d) => selectedManufacturers.includes(d.manufacturer)),
  );

  // Filter data by selected manufacturers, then by date range
  let filteredData = $derived(inDateRange(fullData, dateRange));

  $effect(() => {
    if (!svg || !filteredData) return;
    renderChart();
  });

  function renderChart() {
    if (!svg) return;
    const el = container;
    const width = el.clientWidth;

    // Layout: main chart (260px) + gap (BRUSH_LAYOUT.gap) + brush strip
    // (BRUSH_LAYOUT.stripHeight). Constants live in lib/d3/brush so
    // every chart renders the strip identically.
    const mainHeight = 260;
    const height = mainHeight + BRUSH_LAYOUT.gap + BRUSH_LAYOUT.stripHeight;
    // margin.left is wider than usual so 4–5 digit y-axis tick labels
    // (e.g. "25,000" on the backlog chart) don't overlap the rotated
    // y-axis label. 72px is enough for ~28px of tick label + 44px of
    // breathing room for the rotated chart title.
    const margin = { top: 16, right: 16, bottom: 24, left: 72 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = mainHeight - margin.top - margin.bottom;
    // Brush aligns with the y-axis so the strip's data lines up with
    // the main chart's plot area. The brush's right edge uses
    // BRUSH_MARGIN_RIGHT (16) to keep a small gutter to the card edge.
    const stripWidth = width - margin.left - BRUSH_MARGIN_RIGHT;
    const stripHeight = brushInnerHeight();
    const stripX = margin.left;
    const stripY = brushY(mainHeight);

    // Clear previous render
    d3.select(svg).selectAll('*').remove();
    d3.select(svg).attr('width', width).attr('height', height);

    // Parse dates helper
    const parseDate =
      granularity === 'month'
        ? d3.timeParse('%Y-%m')
        : d3.timeParse('%Y');

    if (filteredData.length === 0) {
      const message = dateRange
        ? `No data in selected range (${dateRange.start} -> ${dateRange.end})`
        : 'No data available';
      d3.select(svg)
        .append('text')
        .attr('x', width / 2)
        .attr('y', mainHeight / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', THEME.textMuted)
        .text(message);
    } else {
      renderMainChart(innerWidth, innerHeight, margin, parseDate);
    }

    // Build the brush data: total counts per date across the
    // currently-selected manufacturers (ignoring dateRange, so the
    // brush always shows the full data range).
    const brushDataMap = new Map<string, number>();
    for (const d of fullData) {
      brushDataMap.set(d.date, (brushDataMap.get(d.date) ?? 0) + d.count);
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
    parseDate: (s: string) => Date | null,
  ) {
    // Get unique manufacturers and dates
    const manufacturers = [...new Set(filteredData.map((d) => d.manufacturer))];
    const dates = [...new Set(filteredData.map((d) => d.date))].sort();

    // Build a matrix: date -> manufacturer -> count
    const dataMap = new Map<string, Map<string, number>>();
    for (const d of filteredData) {
      if (!dataMap.has(d.date)) dataMap.set(d.date, new Map());
      dataMap.get(d.date)!.set(d.manufacturer, d.count);
    }

    const stackedData = dates.map((date) => {
      const row: Record<string, number | string> = { date };
      for (const m of manufacturers) {
        row[m] = dataMap.get(date)?.get(m) ?? 0;
      }
      return row;
    });

    const parsedData = stackedData.map((d) => ({
      ...d,
      _date: parseDate(d.date as string) as Date,
    }));

    // Scales
    const x = d3
      .scaleTime()
      .domain(d3.extent(parsedData, (d) => d._date) as [Date, Date])
      .range([0, innerWidth]);

    const stack = d3
      .stack()
      .keys(manufacturers)
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);

    const series = stack(parsedData as never);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(series, (s) => d3.max(s, (d) => d[1])) as number] as [number, number])
      .range([innerHeight, 0])
      .nice();

    // Colour scale
    const colour = d3
      .scaleOrdinal<string, string>()
      .domain(manufacturers)
      .range(manufacturers.map(getColour));

    // Area generator — d3.stack() wraps data as [y0, y1] arrays with
    // the original object accessible via the `data` property.
    const area = d3
      .area<{ data: { _date: Date } } & Array<number>>()
      .x((d) => x(d.data._date))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveMonotoneX);

    // Create chart group
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

    // Areas
    g.selectAll('path.area')
      .data(series)
      .join('path')
      .attr('class', 'area')
      .attr('fill', (d) => colour(d.key))
      .attr('fill-opacity', 0.7)
      .attr('d', area as never);

    // Axes
    const formatTick =
      granularity === 'month'
        ? d3.timeFormat('%b %Y')
        : d3.timeFormat('%Y');

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

    // Y axis label. Positioned at x = -52 (was -36) so 4–5 digit tick
    // labels on the wide-value charts (e.g. backlog at "25,000")
    // don't crowd the rotated chart title. We bumped margin.left to 72
    // to give this label room to breathe alongside the longest tick
    // values.
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerHeight / 2)
      .attr('y', -52)
      .attr('text-anchor', 'middle')
      .attr('fill', THEME.textMuted)
      .style('font-size', '0.75rem')
      .text(yLabel);

    // Hover interaction
    const focus = g
      .append('g')
      .style('opacity', 0);

    focus
      .append('line')
      .attr('class', 'hover-line')
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
      const date = x.invert(mx);
      // Find nearest data point
      const bisect = d3.bisector((d: { _date: Date }) => d._date).left;
      const idx = bisect(parsedData, date, 1);
      const d0 = parsedData[idx - 1];
      const d1 = parsedData[idx];
      const d = !d1 || date.getTime() - d0._date.getTime() < d1._date.getTime() - date.getTime() ? d0 : d1;

      focus.attr('transform', `translate(${x(d._date)},0)`);
      focus.style('opacity', 1);

      // Build tooltip rows — structured data, no HTML interpolation
      const rows = manufacturers
        .map((m) => ({ m, v: d[m] ?? 0 }))
        .filter((r) => r.v > 0)
        .sort((a, b) => b.v - a.v);

      tooltip.show(
        event,
        formatTick(d._date),
        rows.map((r) => ({
          colour: getColour(r.m),
          label: r.m,
          value: String(r.v),
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

    // Re-render on resize
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
</div>

<style>
  /*
   * D3 v7 brush selection styling. Applied via CSS rather than D3
   * .attr() calls to avoid the D3 brush emitting an invalid rect
   * height (-4) when there's no selection on first render.
   */
  :global(.vt-chart .brush .selection) {
    fill: var(--vt-accent);
    fill-opacity: 0.15;
    stroke: var(--vt-accent);
  }
</style>
