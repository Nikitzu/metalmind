import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

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
