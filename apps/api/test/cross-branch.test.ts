import { beforeEach, describe, expect, it } from 'vitest';
import { as } from './helpers/auth';
import { makeShop, type Shop } from './factories/shop';

type Probe = {
  name: string;
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: (s: Shop) => string;
  body?: (s: Shop) => object;
};

/** GUL staff try to reach DHN. Every probe must return 404 for both of them. THIS LIST GROWS EVERY DAY. */
export const PROBES: Probe[] = [
  { name: 'branch info', method: 'get', path: () => '/api/b/DHN' },
  { name: 'branch info (lowercase code)', method: 'get', path: () => '/api/b/dhn' },
  { name: 'unknown branch', method: 'get', path: () => '/api/b/NOPE' },
  // Day 7+: inventory, adjustments, sales, returns, purchase orders, transfers, movements, dashboard…
];

describe('cross-branch isolation', () => {
  let s: Shop;
  beforeEach(async () => {
    s = await makeShop();
  });

  for (const who of ['cashierGul', 'managerGul'] as const) {
    it.each(PROBES)(`${who}: $name → 404`, async (probe) => {
      const client = as(s[who].token);
      const res = await client[probe.method](probe.path(s)).send(probe.body?.(s) ?? {});
      expect(res.status).toBe(404);
    });
  }

  it('a foreign branch and a non-existent one look exactly the same', async () => {
    const foreign = await as(s.cashierGul.token).get('/api/b/DHN');
    const missing = await as(s.cashierGul.token).get('/api/b/NOPE');
    expect(foreign.body.error).toMatchObject({
      code: missing.body.error.code,
      message: missing.body.error.message,
    });
  });

  it('my branch list never contains other branches', async () => {
    const me = await as(s.cashierGul.token).get('/api/me');
    expect(me.body.branches.map((b: { code: string }) => b.code)).toEqual(['GUL']);
  });
});
