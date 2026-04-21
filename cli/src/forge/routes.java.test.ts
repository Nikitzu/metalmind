import { describe, expect, it } from 'vitest';
import { parseJava } from './routes.js';

describe('parseJava — RestTemplate', () => {
  it('extracts getForObject / postForEntity with URL literal', () => {
    const src = `
      String body = restTemplate.getForObject("/shortened-uri/123", String.class);
      restTemplate.postForEntity("/bookings", payload, Booking.class);
    `;
    const routes = parseJava(src, 'Svc.java', '/repo');
    const pairs = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(pairs).toEqual(['GET /shortened-uri/123', 'POST /bookings']);
    expect(routes.every((r) => r.kind === 'caller' && r.framework === 'java')).toBe(true);
  });

  it('extracts exchange with HttpMethod enum', () => {
    const src = `
      ResponseEntity<String> r = restTemplate.exchange("/v1/items/42", HttpMethod.DELETE, null, String.class);
    `;
    const routes = parseJava(src, 'Svc.java', '/repo');
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ method: 'DELETE', path: '/v1/items/42' });
  });

  it('skips non-absolute URLs (external / variable-built)', () => {
    const src = `
      restTemplate.getForObject("https://external.com/x", String.class);
      restTemplate.getForObject(baseUrl + "/x", String.class);
    `;
    const routes = parseJava(src, 'Svc.java', '/repo');
    expect(routes).toEqual([]);
  });
});

describe('parseJava — WebClient', () => {
  it('extracts fluent .get().uri("...")', () => {
    const src = `
      webClient.get().uri("/health").retrieve();
      webClient.post().uri("/bookings").bodyValue(b).retrieve();
    `;
    const routes = parseJava(src, 'Svc.java', '/repo');
    const pairs = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(pairs).toEqual(['GET /health', 'POST /bookings']);
  });

  it('extracts .method(HttpMethod.X).uri(...)', () => {
    const src = `
      webClient.method(HttpMethod.PATCH).uri("/users/me").bodyValue(p).retrieve();
    `;
    const routes = parseJava(src, 'Svc.java', '/repo');
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ method: 'PATCH', path: '/users/me' });
  });
});

describe('parseJava — Feign', () => {
  it('extracts @GetMapping / @PostMapping only inside @FeignClient interfaces', () => {
    const src = `
      @FeignClient(name = "bookings", url = "\${bookings.url}")
      public interface BookingsClient {
        @GetMapping("/bookings/{id}")
        Booking get(@PathVariable String id);

        @PostMapping(value = "/bookings")
        Booking create(@RequestBody Booking b);
      }
    `;
    const routes = parseJava(src, 'BookingsClient.java', '/repo');
    const pairs = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(pairs).toEqual(['GET /bookings/{id}', 'POST /bookings']);
    expect(routes.every((r) => r.kind === 'caller')).toBe(true);
  });

  it('does NOT treat @GetMapping as caller inside regular Spring controllers', () => {
    const src = `
      @RestController
      public class BookingsController {
        @GetMapping("/bookings/{id}")
        public Booking get() { return null; }
      }
    `;
    const routes = parseJava(src, 'BookingsController.java', '/repo');
    expect(routes).toEqual([]);
  });

  it('extracts @RequestLine in Feign interfaces', () => {
    const src = `
      @FeignClient(name = "x")
      interface XClient {
        @RequestLine("GET /legacy/path")
        String fetch();
      }
    `;
    const routes = parseJava(src, 'XClient.java', '/repo');
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ method: 'GET', path: '/legacy/path' });
  });
});

describe('parseJava — cross-repo wiring', () => {
  it('java caller buckets with openapi handler via canonicalizePath', async () => {
    const { buildRouteMatchEdges } = await import('./routes.js');
    const caller = parseJava(
      'restTemplate.getForObject("/shortened-uri", String.class);',
      'Svc.java',
      '/java-repo',
    );
    const handler = {
      method: 'GET' as const,
      path: '/shortened-uri',
      kind: 'handler' as const,
      framework: 'openapi',
      file: 'openapi.yaml',
      repo: '/java-handler-repo',
    };
    const edges = buildRouteMatchEdges([...caller, handler]);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0]).toMatchObject({ path: '/shortened-uri', method: 'GET' });
  });
});
