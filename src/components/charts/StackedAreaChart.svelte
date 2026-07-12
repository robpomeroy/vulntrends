<script lang="ts">
  /**
   * Stacked area chart — used for discovered/fixed/backlog time series.
   * Renders an SVG via D3, with hover tooltips and manufacturer colour coding.
   * Also renders a D3 brush strip below the main chart for free-form
   * time-range selection. Drag on the brush to zoom; double-click to reset.
   */

  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import { THEME, getColour } from '@/lib/d3/theme';
  import { createTooltip, type Tooltip } from '@/lib/d3/tooltip';
  import { inDateRange, setDateRange, type DateRange } from '@/lib/store';

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

    // Layout: main chart (260px) + gap (8px) + brush strip (50px) = 318px.
    // The brush strip has its own internal padding (4px each side), so the
    // brush inner area is 42px tall. All heights are positive and explicit.
    const mainHeight = 260;
    const gap = 8;
    const brushStripPadding = 4;
    const brushStripHeight = 50;
    const brushInnerHeight = brushStripHeight - brushStripPadding * 2;
    const brushY = mainHeight + gap;
    const height = brushY + brushStripHeight;
    const margin = { top: 16, right: 16, bottom: 24, left: 48 };
    const brushMargin = { left: 48, right: 16, top: brushY + brushStripPadding };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = mainHeight - margin.top - margin.bottom;
    const brushInnerWidth = width - brushMargin.left - brushMargin.right;

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

    renderBrushStrip(brushInnerWidth, brushInnerHeight, brushMargin, parseDate);
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

    // Y axis label
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerHeight / 2)
      .attr('y', -36)
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

  /**
   * Render a minimap strip with a D3 brush for free-form time-range
   * selection. The brush always shows the full data range; dragging
   * selects a sub-range which updates the shared dateRange state.
   * Double-click resets to "all time".
   */
  function renderBrushStrip(
    innerWidth: number,
    innerHeight: number,
    margin: { top: number; right: number; left: number },
    parseDate: (s: string) => Date | null,
  ) {
    if (innerHeight <= 0) return; // safety guard

    // Use fullData (unfiltered by dateRange) so the brush always shows
    // the complete time range regardless of the current zoom level.
    const manufacturers = [...new Set(fullData.map((d) => d.manufacturer))];
    if (manufacturers.length === 0 || fullData.length === 0) return;

    const dates = [...new Set(fullData.map((d) => d.date))].sort();
    const parsedFull = dates.map((d) => ({ date: d, _date: parseDate(d) as Date }));

    const x = d3
      .scaleTime()
      .domain(d3.extent(parsedFull, (d) => d._date) as [Date, Date])
      .range([0, innerWidth]);

    // Build stacked data for the minimap
    const dataMap = new Map<string, number>();
    for (const d of fullData) {
      dataMap.set(d.date, (dataMap.get(d.date) ?? 0) + d.count);
    }
    const stackedData = parsedFull.map((d) => ({
      ...d,
      total: dataMap.get(d.date) ?? 0,
    }));

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(stackedData, (d) => d.total) as number])
      .range([innerHeight, 0])
      .nice();

    const area = d3
      .area<{ _date: Date; total: number }>()
      .x((d) => x(d._date))
      .y0(innerHeight)
      .y1((d) => y(d.total))
      .curve(d3.curveMonotoneX);

    const g = d3
      .select(svg)
      .append('g')
      .attr('class', 'brush-group')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Minimap background
    g.append('rect')
      .attr('class', 'brush-bg')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', THEME.border)
      .attr('fill-opacity', 0.2)
      .attr('rx', 2);

    // Minimap area
    g.append('path')
      .datum(stackedData)
      .attr('fill', THEME.textMuted)
      .attr('fill-opacity', 0.5)
      .attr('d', area as never);

    // "Drag to zoom" hint label
    g.append('text')
      .attr('x', 0)
      .attr('y', -2)
      .attr('fill', THEME.textMuted)
      .style('font-size', '0.625rem')
      .text('Drag to zoom, double-click to reset');

    // Current selection label
    g.append('text')
      .attr('class', 'brush-range-label')
      .attr('x', innerWidth)
      .attr('y', -2)
      .attr('text-anchor', 'end')
      .attr('fill', THEME.accent)
      .style('font-size', '0.625rem');

    // Brush: only respond to 'end' (mouse-up) so the handler doesn't
    // fire on every move. Filter out programmatic events (those without
    // a sourceEvent) so re-attaching the brush with brush.move() does
    // not trigger a spurious update. Also guard against re-render loops
    // by skipping the update when the computed range matches the
    // current store value.
    const brush = d3
      .brushX()
      .extent([
        [0, 0],
        [innerWidth, innerHeight],
      ])
      .on('end', (event) => {
        // Programmatic brush.move() (called on render) fires 'end' with
        // no sourceEvent. Ignore those — only react to user input.
        if (!event.sourceEvent) return;

        const sel = event.selection as [number, number] | null;
        if (!sel) {
          // Selection cleared (e.g. double-click) — reset to all time.
          // Skip the update if already null to break the render loop.
          if (dateRange !== null) setDateRange(null);
          updateSelectionLabel(g, x, sel);
          return;
        }
        const [x0, x1] = sel;
        const startDate = x.invert(x0);
        const endDate = x.invert(x1);
        const newRange: DateRange = {
          start: formatBucket(startDate, granularity),
          end: formatBucket(endDate, granularity),
        };
        // Skip the update if the new range matches the current one.
        // This breaks the re-render loop when the user releases the
        // brush without moving it (a re-render would otherwise fire
        // 'end' again with the same selection).
        if (
          !dateRange ||
          dateRange.start !== newRange.start ||
          dateRange.end !== newRange.end
        ) {
          setDateRange(newRange);
        }
        updateSelectionLabel(g, x, sel);
      });

    // Set the initial brush selection to match the current dateRange,
    // or no selection if dateRange is null.
    let initialSelection: [number, number] | null = null;
    if (dateRange) {
      const startDate = new Date(
        granularity === 'month'
          ? dateRange.start + '-01'
          : dateRange.start + '-01-01',
      );
      const endDate = new Date(
        granularity === 'month'
          ? dateRange.end + '-28'
          : dateRange.end + '-12-31',
      );
      initialSelection = [x(startDate), x(endDate)];
    }

    const brushG = g
      .append('g')
      .attr('class', 'brush')
      .call(brush as never);

    if (initialSelection) {
      brushG.call(brush.move as never, initialSelection);
      // Set the label from the current dateRange. The brush handler
      // can't do this for us because programmatic brush.move() events
      // are filtered out (no sourceEvent).
      updateSelectionLabel(g, x, initialSelection);
    }
  }

  /**
   * Update the range label above the brush to show the current selection.
   */
  function updateSelectionLabel(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    x: d3.ScaleTime<number, number>,
    sel: [number, number] | null,
  ) {
    const label = g.select<SVGTextElement>('.brush-range-label');
    if (!sel) {
      label.text('');
      return;
    }
    const [x0, x1] = sel;
    const startDate = x.invert(x0);
    const endDate = x.invert(x1);
    const fmt = granularity === 'month'
      ? d3.timeFormat('%b %Y')
      : d3.timeFormat('%Y');
    label.text(`${fmt(startDate)} -> ${fmt(endDate)}`);
  }

  /** Format a Date as the aggregation bucket key ("YYYY-MM" or "YYYY"). */
  function formatBucket(date: Date, gran: 'month' | 'year'): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    return gran === 'month' ? `${y}-${m}` : `${y}`;
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
