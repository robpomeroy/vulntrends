<script lang="ts">
  /**
   * Patch lag chart — line chart with median + p90 bands.
   * Shows the time between vulnerability discovery and patch release.
   */

  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import { THEME, getColour } from '@/lib/d3/theme';
  import { createTooltip, type Tooltip } from '@/lib/d3/tooltip';

  interface Props {
    data: Array<{
      date: string;
      manufacturer: string;
      medianLagDays: number;
      p90LagDays: number;
      count: number;
    }>;
    granularity: 'month' | 'year';
    selectedManufacturers: string[];
  }

  let { data, granularity, selectedManufacturers }: Props = $props();

  let container: HTMLDivElement;
  let tooltip: Tooltip;
  let svg: SVGSVGElement;

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
    const width = container.clientWidth;
    const height = 320;
    const margin = { top: 16, right: 16, bottom: 32, left: 56 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    d3.select(svg).selectAll('*').remove();

    if (filteredData.length === 0) {
      d3.select(svg)
        .append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', THEME.textMuted)
        .text('No patch-lag data available');
      return;
    }

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

    // Y axis label
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerHeight / 2)
      .attr('y', -44)
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
      const rows: Array<{ m: string; median: number; p90: number; count: number; date: Date }> = [];
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
        rows.push({
          m: grp.manufacturer,
          median: d.medianLagDays,
          p90: d.p90LagDays,
          count: d.count,
          date: d._date,
        });
      }

      if (rows.length === 0) return;

      // Snap the focus line and tooltip title to the nearest actual data
      // point, not the raw mouse position. This ensures the title, the
      // focus line, and the displayed values all correspond to the same
      // bucket.
      const snapDate = rows[0].date;

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
</div>
