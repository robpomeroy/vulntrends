<script lang="ts">
  /**
   * Stacked area chart — used for discovered/fixed/backlog time series.
   * Renders an SVG via D3, with hover tooltips and manufacturer colour coding.
   */

  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import { THEME, getColour } from '@/lib/d3/theme';
  import { createTooltip, type Tooltip } from '@/lib/d3/tooltip';

  interface Props {
    data: Array<{ date: string; manufacturer: string; count: number }>;
    yLabel: string;
    granularity: 'month' | 'year';
    selectedManufacturers: string[];
  }

  let { data, yLabel, granularity, selectedManufacturers }: Props = $props();

  let container: HTMLDivElement;
  let tooltip: Tooltip;
  let svg: SVGSVGElement;

  // Filter data by selected manufacturers (empty = all)
  let filteredData = $derived(
    selectedManufacturers.length === 0
      ? data
      : data.filter((d) => selectedManufacturers.includes(d.manufacturer)),
  );

  $effect(() => {
    if (!svg || !filteredData) return;
    renderChart();
  });

  function renderChart() {
    if (!svg) return;
    const el = container;
    const width = el.clientWidth;
    const height = 320;
    const margin = { top: 16, right: 16, bottom: 32, left: 48 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Clear previous render
    d3.select(svg).selectAll('*').remove();

    if (filteredData.length === 0) {
      d3.select(svg)
        .append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', THEME.textMuted)
        .text('No data available');
      return;
    }

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

    // Parse dates
    const parseDate =
      granularity === 'month'
        ? d3.timeParse('%Y-%m')
        : d3.timeParse('%Y');
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
      .attr('width', width)
      .attr('height', height)
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
