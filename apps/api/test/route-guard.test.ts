import { describe, expect, it } from 'vitest';
import { AUTHZ } from '../src/middleware/authorize';
import { apiRouter } from '../src/routes';
import { authRouter } from '../src/modules/auth/auth.routes';
import { setupRouter } from '../src/modules/setup/setup.routes';

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
  handle?: { stack?: Layer[]; name?: string } & Record<symbol, unknown>;
};
/** Guest routes by design (FR-AUTH): mounted before authentication. Express 5 names every sub-router
 *  `router`, so they're skipped by IDENTITY, not by name. */
const PUBLIC = new Set<unknown>([setupRouter, authRouter]);

function* walk(stack: Layer[], trail: string): Generator<{ where: string; guarded: boolean }> {
  for (const [i, layer] of stack.entries()) {
    if (layer.route) {
      const guarded = layer.route.stack.some((l) => l.handle?.[AUTHZ]);
      const handlers = layer.route.stack.map((l) => l.handle?.name || 'anonymous').join(', ');
      for (const m of Object.keys(layer.route.methods)) {
        yield { where: `${m.toUpperCase()} ${layer.route.path} (${trail}, handlers: ${handlers})`, guarded };
      }
    } else if (layer.handle?.stack && !PUBLIC.has(layer.handle)) {
      yield* walk(layer.handle.stack, `${trail} > router #${i}`); // a mounted sub-router
    }
  }
}

describe('route guard (FR-SCOPE-07)', () => {
  it('every API route behind authentication declares a permission', () => {
    const routes = [...walk(apiRouter.stack as unknown as Layer[], 'api')];
    expect(routes.length).toBeGreaterThan(60); // the walk really found the routers
    expect(routes.filter((r) => !r.guarded).map((r) => r.where)).toEqual([]);
  });

  it('the walk notices a route without authorize()', () => {
    const fake = {
      stack: [{ route: { path: '/oops', methods: { get: true }, stack: [{ handle: { name: 'h' } }] } }],
    };
    expect([...walk([{ handle: fake }], 'fake')].map((r) => r.guarded)).toEqual([false]);
  });
});
