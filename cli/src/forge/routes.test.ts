import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildRouteMatchEdges,
  canonicalizePath,
  extractRoutes,
  parseJs,
  parsePy,
} from './routes.js';

describe('route parsers', () => {
  it('parseJs finds Express-style handlers', () => {
    const source = `
      import express from 'express';
      const app = express();
      app.get('/users', handler);
      router.post('/trips/:id', create);
    `;
    const routes = parseJs(source, 'server.ts', '/r');
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({ method: 'GET', path: '/users', kind: 'handler' });
    expect(routes[1]).toMatchObject({ method: 'POST', path: '/trips/:id', kind: 'handler' });
  });

  it('parseJs finds fetch and axios callers; fetch defaults to GET', () => {
    const source = `
      await fetch('/api/health');
      axios.post('/trips', payload);
      fetch('https://external/ignored');
    `;
    const routes = parseJs(source, 'client.ts', '/r');
    expect(routes).toHaveLength(2);
    const fetchRoute = routes.find((r) => r.kind === 'caller' && r.path === '/api/health');
    expect(fetchRoute?.method).toBe('GET');
    const axiosRoute = routes.find((r) => r.kind === 'caller' && r.path === '/trips');
    expect(axiosRoute?.method).toBe('POST');
  });

  it('parseJs captures explicit fetch method from init object', () => {
    const source = `
      await fetch('/api/users', { method: 'POST', body: payload });
      fetch('/api/x', { method: 'DELETE' });
    `;
    const routes = parseJs(source, 'client.ts', '/r');
    const post = routes.find((r) => r.path === '/api/users');
    expect(post?.method).toBe('POST');
    const del = routes.find((r) => r.path === '/api/x');
    expect(del?.method).toBe('DELETE');
  });

  it('parsePy finds FastAPI decorators', () => {
    const source = `
@app.get('/users')
def list_users(): ...

@router.post('/trips/{id}')
def create(): ...
`;
    const routes = parsePy(source, 'api.py', '/r');
    expect(routes).toContainEqual(
      expect.objectContaining({ method: 'GET', path: '/users', framework: 'fastapi' }),
    );
    expect(routes).toContainEqual(
      expect.objectContaining({ method: 'POST', path: '/trips/{id}', framework: 'fastapi' }),
    );
  });

  it('parsePy handles Flask @route with methods=', () => {
    const source = `
@app.route('/health', methods=['GET', 'HEAD'])
def health(): ...
`;
    const routes = parsePy(source, 'app.py', '/r');
    expect(routes.filter((r) => r.framework === 'flask')).toHaveLength(2);
  });

  it('buildRouteMatchEdges links caller↔handler across repos', () => {
    const routes = [
      {
        method: 'POST' as const,
        path: '/trips',
        kind: 'handler' as const,
        framework: 'js',
        file: 'h.ts',
        repo: '/serviceA',
      },
      {
        method: 'POST' as const,
        path: '/trips',
        kind: 'caller' as const,
        framework: 'js',
        file: 'c.ts',
        repo: '/serviceB',
      },
      {
        method: 'POST' as const,
        path: '/trips',
        kind: 'caller' as const,
        framework: 'js',
        file: 'intra.ts',
        repo: '/serviceA',
      },
    ];
    const edges = buildRouteMatchEdges(routes);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: '/serviceB::c.ts',
      target: '/serviceA::h.ts',
      confidence: 'INFERRED_ROUTE',
      method: 'POST',
      path: '/trips',
    });
  });

  it('buildRouteMatchEdges ignores method mismatches', () => {
    const routes = [
      {
        method: 'GET' as const,
        path: '/x',
        kind: 'handler' as const,
        framework: 'js',
        file: 'h.ts',
        repo: '/a',
      },
      {
        method: 'POST' as const,
        path: '/x',
        kind: 'caller' as const,
        framework: 'js',
        file: 'c.ts',
        repo: '/b',
      },
    ];
    expect(buildRouteMatchEdges(routes)).toEqual([]);
  });
});

describe('parseUrlLiterals (Tier 3)', () => {
  it('extracts path-shaped string literals and drops obvious non-routes', async () => {
    const { parseUrlLiterals } = await import('./routes.js');
    const src = `
      const log = "/var/log/foo.log";           // dropped: ends in .log
      const asset = "/static/logo.png";          // dropped: .png
      const url = "/api/users/{id}";             // kept
      const route = '/health';                   // kept
      const two = "/v1/bookings/cancel";         // kept
      const bad = "//broken";                    // dropped: //
      const dup = '/health';                     // dedup
    `;
    const out = parseUrlLiterals(src, 'a.ts', '/r');
    const paths = out.map((r) => r.path).sort();
    expect(paths).toEqual(['/api/users/{id}', '/health', '/v1/bookings/cancel']);
    expect(
      out.every((r) => r.kind === 'caller' && r.framework === 'literal' && r.method === 'ANY'),
    ).toBe(true);
  });

  it('buildRouteMatchEdges tags URL-literal callers with INFERRED_URL_LITERAL confidence', async () => {
    const { buildRouteMatchEdges, parseUrlLiterals } = await import('./routes.js');
    const callers = parseUrlLiterals('const u = "/health";', 'client.go', '/consumer');
    const handler = {
      method: 'GET' as const,
      path: '/health',
      kind: 'handler' as const,
      framework: 'openapi',
      file: 'spec.yaml',
      repo: '/provider',
    };
    const edges = buildRouteMatchEdges([...callers, handler]);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.confidence).toBe('INFERRED_URL_LITERAL');
  });

  it('extractRoutes includes literals only when opted in', async () => {
    const { extractRoutes } = await import('./routes.js');
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const tmp = await mkdtemp(join(tmpdir(), 'mm-lit-'));
    try {
      await writeFile(join(tmp, 'cfg.yaml'), 'endpoint: "/legacy/ping"', 'utf8');
      const off = await extractRoutes(tmp);
      expect(off.find((r) => r.path === '/legacy/ping')).toBeUndefined();
      const on = await extractRoutes(tmp, { includeLiterals: true });
      expect(on.find((r) => r.path === '/legacy/ping')).toBeTruthy();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('canonicalizePath', () => {
  it('maps every param notation to :param so cross-repo edges bucket together', () => {
    const inputs = ['/users/:id', '/users/{id}', '/users/<int:id>', '/users/${id}'];
    const canon = inputs.map(canonicalizePath);
    expect(new Set(canon).size).toBe(1);
    expect(canon[0]).toBe('/users/:param');
  });

  it('prepends leading slash and strips query + trailing slash', () => {
    expect(canonicalizePath('users/:id/')).toBe('/users/:param');
    expect(canonicalizePath('/users/:id?foo=bar')).toBe('/users/:param');
  });

  it('preserves root', () => {
    expect(canonicalizePath('/')).toBe('/');
  });

  it('buildRouteMatchEdges links FastAPI handler to Express caller via canonical path', () => {
    const edges = buildRouteMatchEdges([
      {
        method: 'GET',
        path: '/users/{id}',
        kind: 'handler',
        framework: 'fastapi',
        file: 'api.py',
        repo: '/py-service',
      },
      {
        method: 'GET',
        path: '/users/:id',
        kind: 'caller',
        framework: 'js',
        file: 'client.ts',
        repo: '/js-client',
      },
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: '/js-client::client.ts',
      target: '/py-service::api.py',
      method: 'GET',
    });
  });
});

describe('extractRoutes (integration)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'metalmind-routes-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('walks a repo and collects routes, skipping node_modules', async () => {
    await mkdir(join(tmp, 'src'), { recursive: true });
    await mkdir(join(tmp, 'node_modules', 'junk'), { recursive: true });
    await writeFile(
      join(tmp, 'src', 'server.ts'),
      "const app = express(); app.get('/a', h);",
      'utf8',
    );
    await writeFile(
      join(tmp, 'node_modules', 'junk', 'a.ts'),
      "app.post('/should-be-ignored', h);",
      'utf8',
    );
    await writeFile(join(tmp, 'api.py'), "@app.get('/b')\ndef h(): ...\n", 'utf8');

    const routes = await extractRoutes(tmp);
    const paths = routes.map((r) => r.path).sort();
    expect(paths).toEqual(['/a', '/b']);
  });
});
