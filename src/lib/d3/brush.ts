/**
 * D3 brush strip — shared minimap + brush component for time-series charts.
 * Renders a small area chart of the data's overall volume with a brush overlay
 * for free-form time-range selection.
 *
 * Used by StackedAreaChart and PatchLagChart so the brush behaves consistently
 * across all four dashboard panels and writes to the same shared dateRange
 * store.
 *
 * Why this lives in its own module (rather than being copy-pasted into each
 * chart):
 * - The brush needs layered guards to avoid a Svelte 5 render loop.
 *   Centralising them keeps the fix from drifting between components.
 * - The layout constants (50px strip, 8px gap above the strip) are part of the
 *   dashboard's visual design and should match across charts.
 */

import * as d3 from 'd3';
import { THEME } from './theme';
import { setDateRange, type DateRange } from '../store';

/**
 * Strip layout constants. Kept in one place so every chart renders
 * the brush at the same height.
 *
 * The strip has NO internal padding — the brush fills the strip end
 * to end so the bottom of the strip lines up with the bottom of the
 * SVG and the card border. The "Drag to zoom" hint label lives in
 * the gap above the strip (at y = -2 from the strip top).
 */
export const BRUSH_LAYOUT = {
  /** Total height of the strip. The brush fills it completely. */
  stripHeight: 50,
  /** Gap between the main chart and the strip. The hint label
   *  ("Drag to zoom, double-click to reset") sits in this gap. */
  gap: 8,
} as const;

/** The brush's height equals the strip height (no internal padding). */
export function brushInnerHeight(): number {
  return BRUSH_LAYOUT.stripHeight;
}

/** Y offset (relative to the SVG top) where the strip starts. */
export function brushY(mainHeight: number): number {
  return mainHeight + BRUSH_LAYOUT.gap;
}

/** Total SVG height: main chart + gap + strip. */
export function chartSvgHeight(mainHeight: number): number {
  return mainHeight + BRUSH_LAYOUT.gap + BRUSH_LAYOUT.stripHeight;
}

/**
 * Default right margin between the brush strip and the SVG edge. The
 * left margin is supplied by the caller because it must match the
 * main chart's `margin.left` (which varies with the y-axis label
 * width — e.g. "Days to patch" is wider than "Vulnerabilities").
 */
export const BRUSH_MARGIN_RIGHT = 16;

/** Arguments for {@link renderBrushStrip}. */
export interface BrushStripOptions {
  /** SVG element the brush is appended to. */
  svg: SVGSVGElement;
  /** Strip inner width (after the chart's left/right margins). */
  innerWidth: number;
  /** Strip inner height (after the strip's own padding). */
  innerHeight: number;
  /**
   * X offset of the strip's inner area, relative to the SVG left edge.
   * Defaults to the strip's left margin but should be set to match the
   * main chart's `margin.left` so the brush aligns with the plot area
   * (not the y-axis labels).
   */
  xOffset: number;
  /** Y offset of the strip's inner area, relative to the SVG top. */
  yOffset: number;
  /** Per-date data points. Must include `date` (bucket key) and a
   *  numeric `value` used to draw the minimap area. */
  data: Array<{ date: string; value: number }>;
  /** Granularity — controls the date format for the range label. */
  granularity: 'month' | 'year';
  /** Current date range. The brush is positioned to match this on
   *  render, and the label is set from it. */
  dateRange: DateRange | null;
}

/**
 * Render the brush strip on the given SVG. The brush always shows
 * the full data range so the user can re-zoom into a different
 * period. Dragging calls `setDateRange`; clearing the selection resets
 * the range to "all time".
 */
export function renderBrushStrip(opts: BrushStripOptions): void {
  const { svg, innerWidth, innerHeight, xOffset, yOffset, data, granularity, dateRange } = opts;

  if (innerHeight <= 0 || innerWidth <= 0) return;
  if (data.length === 0) return;

  const parseDate =
    granularity === 'month' ? d3.timeParse('%Y-%m') : d3.timeParse('%Y');

  const parsed = data
    .map((d) => ({ date: d.date, _date: parseDate(d.date) as Date, value: d.value }))
    .filter((d) => d._date instanceof Date && !isNaN(d._date.getTime()))
    .sort((a, b) => a._date.getTime() - b._date.getTime());

  if (parsed.length === 0) return;

  // Defensive: skip rendering if the data has invalid values. d3
  // produces NaN path commands when the y-domain is undefined, which
  // shows up as a console error and an empty path on the screen.
  const validValues = parsed
    .map((d) => d.value)
    .filter((v): v is number => Number.isFinite(v));
  if (validValues.length === 0) return;
  const maxValue = d3.max(validValues);
  if (maxValue === undefined || !Number.isFinite(maxValue)) return;

  const x = d3
    .scaleTime()
    .domain(d3.extent(parsed, (d) => d._date) as [Date, Date])
    .range([0, innerWidth]);

  const y = d3
    .scaleLinear()
    .domain([0, maxValue])
    .range([innerHeight, 0])
    .nice();

  const area = d3
    .area<{ _date: Date; value: number }>()
    .x((d) => x(d._date))
    .y0(innerHeight)
    .y1((d) => y(d.value))
    .curve(d3.curveMonotoneX);

  const g = d3
    .select(svg)
    .append('g')
    .attr('class', 'brush-group')
    .attr('transform', `translate(${xOffset},${yOffset})`);

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
    .datum(parsed)
    .attr('fill', THEME.textMuted)
    .attr('fill-opacity', 0.5)
    .attr('d', area as never);

  // "Drag to zoom" hint label. The D3 v7 brush clears the selection
  // when you drag a handle off the edge of the strip, or via the
  // "All time" preset button — there's no built-in double-click
  // reset, so the hint just describes what the user can do here.
  g.append('text')
    .attr('x', 0)
    .attr('y', -2)
    .attr('fill', THEME.textMuted)
    .style('font-size', '0.625rem')
    .text('Drag to zoom');

  // Current selection label
  const label = g
    .append('text')
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
        // Selection cleared (e.g. click outside the selection) — reset to all time.
        // Skip the update if already null to break the render loop.
        if (dateRange !== null) setDateRange(null);
        updateLabel(label, x, sel, granularity);
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
      updateLabel(label, x, sel, granularity);
    });

  // Set the initial brush selection to match the current dateRange,
  // or no selection if dateRange is null. The end is positioned at
  // the *last* day of the end bucket (e.g. 31st for July, 28/29 for
  // February) so the visible selection covers the inclusive range
  // rather than stopping a few days short.
  //
  // We parse the start through the same d3 parser used for the data
  // (rather than `new Date(string) + '-01'`) because the parser
  // produces a local-midnight Date — important in negative-offset
  // timezones where `new Date('2024-07-01')` parses as UTC midnight,
  // which lands on Jun 30 local in PDT, shifting the brush and its
  // label by a day.
  let initialSelection: [number, number] | null = null;
  if (dateRange) {
    const startDate = parseDate(dateRange.start) ?? new Date(dateRange.start);
    const endDate = parseBucketEnd(dateRange.end, granularity);
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
    updateLabel(label, x, initialSelection, granularity);
  }
}

/** Format a Date as the aggregation bucket key ("YYYY-MM" or "YYYY"). */
function formatBucket(date: Date, gran: 'month' | 'year'): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return gran === 'month' ? `${y}-${m}` : `${y}`;
}

/**
 * Parse a bucket key and return the Date that represents the *last*
 * day of that bucket (used to position the brush selection so it
 * covers the inclusive end of the range).
 *
 * For "YYYY-MM" returns the last calendar day of that month
 * (handles 28/29/30/31-day months and leap years). For "YYYY"
 * returns December 31st of that year.
 *
 * Implementation: for "YYYY-MM" we set the date to day 0 of the
 * *next* month in UTC, which JS Date rolls back to the last day of
 * the current month. For "YYYY" we set the date to Dec 31 of that
 * year. All operations use UTC methods because `new Date("YYYY-MM")`
 * is parsed in UTC (midnight on the 1st) — mixing in local-time
 * methods shifts the date by the local UTC offset.
 */
function parseBucketEnd(bucket: string, gran: 'month' | 'year'): Date {
  const d = new Date(bucket);
  if (gran === 'year') {
    d.setUTCMonth(11, 31);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Set the range label text to reflect the current brush selection. */
function updateLabel(
  label: d3.Selection<SVGTextElement, unknown, null, undefined>,
  x: d3.ScaleTime<number, number>,
  sel: [number, number] | null,
  granularity: 'month' | 'year',
): void {
  if (!sel) {
    label.text('');
    return;
  }
  const [x0, x1] = sel;
  const fmt = granularity === 'month' ? d3.timeFormat('%b %Y') : d3.timeFormat('%Y');
  label.text(`${fmt(x.invert(x0))} -> ${fmt(x.invert(x1))}`);
}
