import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRouteMatchEdges, extractRoutes, parseJs, parsePy } from './routes.js';

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
