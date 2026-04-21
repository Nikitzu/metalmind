import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveBasePath,
  extractOpenApiRoutes,
  parseOpenApiDoc,
  shelfDir,
} from './openapi.js';
import { buildRouteMatchEdges, extractRoutes } from './routes.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'openapi');

describe('deriveBasePath', () => {
  it('returns empty when no servers', () => {
    expect(deriveBasePath(undefined)).toBe('');
    expect(deriveBasePath([])).toBe('');
  });

  it('picks shortest path across servers to avoid prod-only prefix', () => {
    const servers = [
      { url: 'https://prod.example.com/api' },
      { url: 'http://localhost:8080' },
    ];
    expect(deriveBasePath(servers)).toBe('');
  });

  it('uses the common basePath when all servers share one', () => {
    const servers = [
      { url: 'https://a.example.com/api' },
      { url: 'https://b.example.com/api' },
    ];
    expect(deriveBasePath(servers)).toBe('/api');
  });

  it('falls back to raw url when not a valid URL', () => {
    expect(deriveBasePath([{ url: '/v1' }])).toBe('/v1');
  });
});

describe('parseOpenApiDoc', () => {
  it('emits one handler per method per path', () => {
    const doc = {
      paths: {
        '/users': { get: {}, post: {} },
        '/users/{id}': { get: {}, delete: {} },
      },
    };
    const routes = parseOpenApiDoc(doc, 'spec.yaml', '/r');
    expect(routes).toHaveLength(4);
    expect(routes.every((r) => r.kind === 'handler')).toBe(true);
    expect(routes.every((r) => r.framework === 'openapi')).toBe(true);
    const keys = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(keys).toEqual([
      'DELETE /users/{id}',
      'GET /users',
      'GET /users/{id}',
      'POST /users',
    ]);
  });

  it('prepends servers basePath when shared', () => {
    const doc = {
      servers: [{ url: 'https://a/api' }, { url: 'https://b/api' }],
      paths: { '/health': { get: {} } },
    };
    const routes = parseOpenApiDoc(doc, 'spec.yaml', '/r');
    expect(routes[0]?.path).toBe('/api/health');
  });

  it('ignores non-method keys inside a path item', () => {
    const doc = {
      paths: {
        '/x': { get: {}, parameters: [{ name: 'q' }], summary: 'x', description: 'y' },
      },
    };
    const routes = parseOpenApiDoc(doc, 'spec.yaml', '/r');
    expect(routes).toHaveLength(1);
  });

  it('returns [] for malformed input', () => {
    expect(parseOpenApiDoc(null, 'spec.yaml', '/r')).toEqual([]);
    expect(parseOpenApiDoc({}, 'spec.yaml', '/r')).toEqual([]);
    expect(parseOpenApiDoc({ paths: 'nope' }, 'spec.yaml', '/r')).toEqual([]);
  });
});

describe('extractOpenApiRoutes (shelf-only)', () => {
  let home: string;
  let repo: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'metalmind-home-'));
    repo = await mkdtemp(join(tmpdir(), 'coreapi-bookings-'));
    prevHome = process.env.HOME;
    process.env.HOME = home;
    await mkdir(shelfDir(), { recursive: true });
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    await rm(home, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  it('returns [] when no spec is on the shelf', async () => {
    await expect(extractOpenApiRoutes(repo)).resolves.toEqual([]);
  });

  it('ignores specs inside the target repo — shelf only', async () => {
    await copyFile(join(FIXTURES, 'springdoc.yaml'), join(repo, 'openapi.yaml'));
    await expect(extractOpenApiRoutes(repo)).resolves.toEqual([]);
  });

  it('reads a shelf spec keyed on repo basename', async () => {
    const dest = join(shelfDir(), `${basenameOf(repo)}.yaml`);
    await copyFile(join(FIXTURES, 'springdoc.yaml'), dest);
    const routes = await extractOpenApiRoutes(repo);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every((r) => r.framework === 'openapi')).toBe(true);
    const pairs = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(pairs).toContain('GET /shortened-uri');
    expect(pairs).toContain('POST /shortened-uri');
    expect(pairs).toContain('DELETE /shortened-uri/{id}');
  });

  it('reads .json from the shelf', async () => {
    const doc = { paths: { '/ping': { get: {} } } };
    await writeFile(join(shelfDir(), `${basenameOf(repo)}.json`), JSON.stringify(doc), 'utf8');
    const routes = await extractOpenApiRoutes(repo);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ method: 'GET', path: '/ping', framework: 'openapi' });
  });

  it('prefers yaml over yml over json when multiple exist', async () => {
    const base = basenameOf(repo);
    await copyFile(join(FIXTURES, 'swagger2.yaml'), join(shelfDir(), `${base}.yaml`));
    await writeFile(join(shelfDir(), `${base}.json`), JSON.stringify({ paths: { '/z': { get: {} } } }));
    const routes = await extractOpenApiRoutes(repo);
    expect(routes.some((r) => r.path === '/bookings')).toBe(true);
    expect(routes.some((r) => r.path === '/z')).toBe(false);
  });
});

describe('extractRoutes wiring (shelf)', () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'metalmind-home-'));
    prevHome = process.env.HOME;
    process.env.HOME = home;
    await mkdir(shelfDir(), { recursive: true });
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    await rm(home, { recursive: true, force: true });
  });

  it('OpenAPI handlers (shelf) bucket with JS callers via canonicalizePath', async () => {
    const javaRepo = await mkdtemp(join(tmpdir(), 'coreapi-urishortener-'));
    const jsRepo = await mkdtemp(join(tmpdir(), 'traveller-portal-'));
    try {
      await copyFile(
        join(FIXTURES, 'springdoc.yaml'),
        join(shelfDir(), `${basenameOf(javaRepo)}.yaml`),
      );
      await writeFile(
        join(jsRepo, 'client.ts'),
        "axios.get('/shortened-uri/:id');",
        'utf8',
      );
      const routes = [
        ...(await extractRoutes(javaRepo)),
        ...(await extractRoutes(jsRepo)),
      ];
      const edges = buildRouteMatchEdges(routes);
      expect(edges.length).toBeGreaterThan(0);
      expect(edges.some((e) => e.path === '/shortened-uri/{id}')).toBe(true);
    } finally {
      await rm(javaRepo, { recursive: true, force: true });
      await rm(jsRepo, { recursive: true, force: true });
    }
  });
});

function basenameOf(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}
