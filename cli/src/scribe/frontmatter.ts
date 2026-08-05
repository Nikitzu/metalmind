import { open, readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

export interface SplitNote {
  raw: string;
  body: string;
  bodyStart: number;
}

const FENCE = '\n---';

export function splitFrontmatter(source: string): SplitNote {
  if (!source.startsWith('---\n')) return { raw: '', body: source, bodyStart: 0 };
  let cursor = 3;
  while (cursor < source.length) {
    const at = source.indexOf(FENCE, cursor);
    if (at < 0) break;
    const after = at + FENCE.length;
    const rest = source.slice(after);
    if (rest === '' || rest.startsWith('\n') || rest.startsWith('\r\n')) {
      const bodyStart = after + (rest.startsWith('\r\n') ? 2 : rest.startsWith('\n') ? 1 : 0);
      return { raw: source.slice(4, at), body: source.slice(bodyStart), bodyStart };
    }
    cursor = after;
  }
  return { raw: '', body: source, bodyStart: 0 };
}

export function parseFrontmatter(source: string): {
  fm: Record<string, unknown>;
  bodyStart: number;
} {
  const { raw, bodyStart } = splitFrontmatter(source);
  if (!raw.trim()) return { fm: {}, bodyStart };
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return { fm: {}, bodyStart };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { fm: {}, bodyStart };
  }
  return { fm: parsed as Record<string, unknown>, bodyStart };
}

export function frontmatterString(fm: Record<string, unknown>, key: string): string | null {
  const v = fm[key];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
}

export function frontmatterList(fm: Record<string, unknown>, key: string): string[] {
  const v = fm[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

const HEAD_CHUNK = 8192;

export async function readNoteFrontmatter(path: string): Promise<Record<string, unknown>> {
  let head: string;
  try {
    const handle = await open(path, 'r');
    try {
      const buf = Buffer.alloc(HEAD_CHUNK);
      const { bytesRead } = await handle.read(buf, 0, HEAD_CHUNK, 0);
      head = buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return {};
  }
  if (!head.startsWith('---\n')) return {};
  if (splitFrontmatter(head).bodyStart === 0) {
    try {
      head = await readFile(path, 'utf8');
    } catch {
      return {};
    }
  }
  return parseFrontmatter(head).fm;
}
