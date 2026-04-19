import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';

export interface SentinelMarkers {
  begin: string;
  end: string;
}

export const DEFAULT_METALMIND_MARKERS: SentinelMarkers = {
  begin: '<!-- metalmind:managed:begin -->',
  end: '<!-- metalmind:managed:end -->',
};

export type SentinelUpsertAction = 'created' | 'inserted' | 'updated' | 'unchanged';

export interface UpsertSentinelBlockOptions {
  path: string;
  content: string;
  markers?: SentinelMarkers;
}

export interface UpsertSentinelBlockResult {
  action: SentinelUpsertAction;
}

function buildBlock(content: string, markers: SentinelMarkers): string {
  const body = content.endsWith('\n') ? content : `${content}\n`;
  return `${markers.begin}\n${body}${markers.end}`;
}

function findMarkers(
  source: string,
  markers: SentinelMarkers,
): { start: number; end: number } | null {
  const start = source.indexOf(markers.begin);
  if (start === -1) return null;
  const endIdx = source.indexOf(markers.end, start + markers.begin.length);
  if (endIdx === -1) return null;
  return { start, end: endIdx + markers.end.length };
}

export async function upsertSentinelBlock(
  opts: UpsertSentinelBlockOptions,
): Promise<UpsertSentinelBlockResult> {
  const markers = opts.markers ?? DEFAULT_METALMIND_MARKERS;
  const block = buildBlock(opts.content, markers);

  if (!existsSync(opts.path)) {
    await writeFile(opts.path, `${block}\n`, 'utf8');
    return { action: 'created' };
  }

  const current = await readFile(opts.path, 'utf8');
  const found = findMarkers(current, markers);

  if (found) {
    const existing = current.slice(found.start, found.end);
    if (existing === block) return { action: 'unchanged' };
    const next = current.slice(0, found.start) + block + current.slice(found.end);
    await writeFile(opts.path, next, 'utf8');
    return { action: 'updated' };
  }

  const needsSeparator = current.length > 0 && !current.startsWith('\n');
  const next = `${block}\n${needsSeparator ? '\n' : ''}${current}`;
  await writeFile(opts.path, next, 'utf8');
  return { action: 'inserted' };
}

export function extractSentinelBlock(
  source: string,
  markers: SentinelMarkers = DEFAULT_METALMIND_MARKERS,
): string | null {
  const found = findMarkers(source, markers);
  if (!found) return null;
  const inner = source.slice(found.start + markers.begin.length, found.end - markers.end.length);
  return inner.replace(/^\n/, '').replace(/\n$/, '');
}

export type SentinelRemoveAction = 'removed' | 'file-empty' | 'no-markers' | 'no-file';

export interface RemoveSentinelBlockOptions {
  path: string;
  markers?: SentinelMarkers;
  /** When true, delete the file if removing the block leaves it blank. Default: false. */
  deleteIfEmpty?: boolean;
}

export interface RemoveSentinelBlockResult {
  action: SentinelRemoveAction;
}

export async function removeSentinelBlock(
  opts: RemoveSentinelBlockOptions,
): Promise<RemoveSentinelBlockResult> {
  const markers = opts.markers ?? DEFAULT_METALMIND_MARKERS;
  if (!existsSync(opts.path)) return { action: 'no-file' };

  const current = await readFile(opts.path, 'utf8');
  const found = findMarkers(current, markers);
  if (!found) return { action: 'no-markers' };

  const before = current.slice(0, found.start).replace(/\s+$/, '');
  const after = current.slice(found.end).replace(/^\s+/, '');
  const next = [before, after].filter(Boolean).join('\n\n');

  if (!next.trim()) {
    if (opts.deleteIfEmpty) {
      await unlink(opts.path);
      return { action: 'file-empty' };
    }
    await writeFile(opts.path, '', 'utf8');
    return { action: 'file-empty' };
  }

  await writeFile(opts.path, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
  return { action: 'removed' };
}
