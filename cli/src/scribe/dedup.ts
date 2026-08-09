import { recallAuthHeaders } from '../backends/recall-token.js';

export interface DedupHit {
  file: string;
  score: number;
}

export const DEDUP_THRESHOLD = 0.8;
const DEDUP_QUERY_CHARS = 800;
const DEDUP_TIMEOUT_MS = 2_500;
const DEFAULT_HTTP_ENDPOINT = 'http://127.0.0.1:17317';

export async function findOverlappingNotes(opts: {
  title: string;
  body: string;
  httpEndpoint?: string | null;
  threshold?: number;
}): Promise<DedupHit[]> {
  const endpoint =
    opts.httpEndpoint || process.env.METALMIND_RECALL_HTTP || DEFAULT_HTTP_ENDPOINT;
  const query = `${opts.title}\n${opts.body}`.slice(0, DEDUP_QUERY_CHARS).trim();
  if (!query) return [];
  const threshold = opts.threshold ?? DEDUP_THRESHOLD;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEDUP_TIMEOUT_MS);
  try {
    const res = await fetch(`${endpoint}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await recallAuthHeaders()) },
      body: JSON.stringify({ query, k: 3, mode: 'semantic-only' }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { hits?: Array<Record<string, unknown>> };
    return (json.hits ?? [])
      .filter(
        (h): h is { file: string; score: number } =>
          typeof h.file === 'string' && typeof h.score === 'number' && h.score >= threshold,
      )
      .map((h) => ({ file: h.file, score: h.score }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function formatOverlapWarning(hits: DedupHit[]): string {
  const lines = hits.map((h) => `  ${h.score.toFixed(2)}  ${h.file}`);
  return [
    'draft overlaps existing note(s):',
    ...lines,
    'review the overlap - `metalmind scribe update <note>` extends instead of duplicating.',
  ].join('\n');
}
