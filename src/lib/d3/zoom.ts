/**
 * Pure-function helpers for the + / – zoom controls on the chart
 * cards. Lives alongside `brush.ts` so both pieces of the chart's
 * zoom UX live next to each other, but is in its own file because
 * the math has nothing to do with D3 rendering — it just needs the
 * current range and the data extent to decide on a new range.
 *
 * Granularity rules:
 *
 * - We compute the new range as a slice on the underlying date
 *   array (the data points the chart knows about) rather than as
 *   a fixed time delta. This is correct for both monthly and
 *   yearly buckets: a "zoom in" step on the monthly chart halves
 *   the number of months visible, not the number of days.
 *
 * - Floor / ceil land on *existing* bucket boundaries. Stepping
 *   from a half-step to a whole-step range is fine — we just pick
 *   the existing bucket that's nearest to the target date. This
 *   matches what the brush itself does (D3 bisects the data).
 *
 * - Clamping against the data extent means a user who repeatedly
 *   hits + ends up staring at a single bucket rather than a
 *   pixel-thin slice. That's a much better UX than a microscopic
 *   chart with broken axis ticks.
 */

import type { DateRange, Granularity } from '../store';

/** Minimum number of buckets to keep visible after a zoom-in. */
const MIN_BUCKETS = 2;

/**
 * Compute the zoomed-in (or zoomed-out) range.
 *
 * - `current`: the active range (use `null` for "all time")
 * - `dataKeys`: every bucket key in the dataset, sorted ascending
 *   (e.g. `["1996-01", "1996-02", ..., "2025-12"]` for monthly data).
 *   The chart component supplies these so the math doesn't have to
 *   know about the underlying data shape.
 * - `factor`: < 1 zooms in (e.g. 0.5 halves the visible range), >
 *   1 zooms out. We use 0.5 for + and 2.0 for –.
 * - `granularity`: controls bucket formatting. The returned range
 *   uses the same format as `dataKeys` so `inDateRange` lines them
 *   up correctly.
 *
 * Returns `null` when the new range would cover the entire dataset
 * (matching the brush's "select the whole strip" convention, which
 * `setDateRange(null)` represents as "show all time").
 */
export function computeZoomedRange(
  current: DateRange | null,
  dataKeys: readonly string[],
  factor: number,
  granularity: Granularity,
): DateRange | null {
  if (dataKeys.length === 0) return current;
  if (factor <= 0 || !Number.isFinite(factor)) return current;

  const dataMin = dataKeys[0];
  const dataMax = dataKeys[dataKeys.length - 1];

  // Pick the anchor for the zoom — the midpoint of the current
  // selection (or the midpoint of the data extent if there's no
  // active selection). We keep this as a *bucket key* (string),
  // not a Date, so we never accidentally land between buckets.
  const anchorKey = pickAnchor(current, dataKeys);
  const anchorIdx = dataKeys.indexOf(anchorKey);
  if (anchorIdx < 0) {
    // Defensive: the anchor should always exist in the data, but
    // if it doesn't (e.g. the user's range goes outside the loaded
    // data), fall back to the middle of the visible dataset.
    return pivotFromCenter(dataKeys, current, factor, granularity);
  }

  // Compute the half-widths in bucket indices on each side of the
  // anchor. We split asymmetrically (floor / ceil) so the resulting
  // slice always *contains* the anchor — half-step differences
  // don't accidentally exclude the bucket the user is centred on.
  const halfVisible = (current ? countBucketsInRange(current, dataKeys, anchorIdx) : dataKeys.length) / 2;
  const newHalfWidth = Math.max(1, Math.floor(halfVisible * factor));

  const startIdx = Math.max(0, anchorIdx - newHalfWidth);
  const endIdx = Math.min(dataKeys.length - 1, anchorIdx + newHalfWidth);

  // If the new slice covers the entire dataset, return null so the
  // caller renders "all time" (matching the brush clearing).
  if (startIdx <= 0 && endIdx >= dataKeys.length - 1) return null;

  // Enforce a minimum zoom-in floor: never show fewer than
  // MIN_BUCKETS buckets, otherwise the chart axis breaks. If the
  // user is already at the floor, return the current range (no-op)
  // so repeated + presses don't disable the button permanently.
  if (endIdx - startIdx + 1 < MIN_BUCKETS) {
    return current ?? { start: dataMin, end: dataMax };
  }

  return {
    start: dataKeys[startIdx],
    end: dataKeys[endIdx],
  };
}

/**
 * Count the number of buckets inside a range, where the range may
 * lie *partially* outside the available data keys. Returned as
 * `floor(leftHalf) + ceil(rightHalf)` so we keep integer counts and
 * stay symmetric when the data covers the whole range.
 *
 * Exported so unit tests can verify the boundary cases without
 * dragging in Svelte / D3 / the store.
 */
export function countBucketsInRange(
  range: DateRange,
  dataKeys: readonly string[],
  anchorIdx: number,
): number {
  let leftHalf = 0;
  for (let i = anchorIdx - 1; i >= 0 && dataKeys[i] >= range.start; i--) leftHalf++;
  let rightHalf = 0;
  for (let i = anchorIdx + 1; i < dataKeys.length && dataKeys[i] <= range.end; i++) rightHalf++;
  return leftHalf + rightHalf + 1;
}

/**
 * Pick a bucket key to centre the zoom on. If the user has a
 * selection, that's the midpoint of the selection; if not, the
 * midpoint of the data extent.
 */
function pickAnchor(current: DateRange | null, dataKeys: readonly string[]): string {
  if (!current) {
    return dataKeys[Math.floor(dataKeys.length / 2)];
  }
  // bisect: pick the middle bucket inside the selection.
  const startIdx = findIndexGte(dataKeys, current.start);
  const endIdx = findIndexLte(dataKeys, current.end);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    return dataKeys[Math.floor(dataKeys.length / 2)];
  }
  const mid = Math.floor((startIdx + endIdx) / 2);
  return dataKeys[mid];
}

/**
 * Fallback used when the anchor isn't found in the data keys —
 * usually because the chart's filtered data is missing some
 * peripheral months. Treats the current range (or data extent) as
 * the new centre and shrinks/grows symmetrically.
 */
function pivotFromCenter(
  dataKeys: readonly string[],
  current: DateRange | null,
  factor: number,
  _granularity: Granularity,
): DateRange | null {
  const anchorIdx = current
    ? Math.floor((findIndexGte(dataKeys, current.start) + findIndexLte(dataKeys, current.end)) / 2)
    : Math.floor(dataKeys.length / 2);
  if (anchorIdx < 0 || anchorIdx >= dataKeys.length) return current;
  const halfWidth = Math.max(1, Math.floor(((current ? Math.max(1, findIndexLte(dataKeys, current.end) - findIndexGte(dataKeys, current.start)) : dataKeys.length) / 2) * factor));
  const startIdx = Math.max(0, anchorIdx - halfWidth);
  const endIdx = Math.min(dataKeys.length - 1, anchorIdx + halfWidth);
  if (endIdx - startIdx + 1 < MIN_BUCKETS) return current ?? { start: dataKeys[0], end: dataKeys[dataKeys.length - 1] };
  if (startIdx <= 0 && endIdx >= dataKeys.length - 1) return null;
  return { start: dataKeys[startIdx], end: dataKeys[endIdx] };
}

function findIndexGte(keys: readonly string[], target: string): number {
  for (let i = 0; i < keys.length; i++) if (keys[i] >= target) return i;
  return -1;
}

function findIndexLte(keys: readonly string[], target: string): number {
  for (let i = keys.length - 1; i >= 0; i--) if (keys[i] <= target) return i;
  return -1;
}
