/**
 * Shared atomic JSON writer for the data pipeline.
 *
 * Writes to a temp file in the same directory, then renames it over the
 * destination. `rename` is atomic on the same filesystem, so a concurrent
 * reader (e.g. `astro build`, or a later stage of a publish after a
 * `data:build` timeout) never sees a partially-written file — it either
 * sees the old complete file or the new complete file.
 *
 * The publish pipeline treats a `data:build` timeout as non-fatal and
 * continues with whatever data is on disk. Because the aggregator and
 * pipeline write directly with `writeFile`, a timeout mid-write could
 * otherwise leave a truncated JSON file that `data:validate` would fail
 * against (or, worse, that a `--skip=data:validate` deploy would ship).
 * Atomic writes close that gap at the root.
 */

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Write `data` as JSON to `path` atomically (write temp + rename). */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2) + '\n';
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${randomBytes(4).toString('hex')}.tmp`);
  await writeFile(tmp, json, 'utf-8');
  await rename(tmp, path);
}