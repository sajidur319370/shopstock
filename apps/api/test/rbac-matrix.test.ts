import { describe, expect, it } from 'vitest';
import { can, type Permission } from '@shopstock/shared';
import { as } from './helpers/auth';
import { makeShop, type Shop } from './factories/shop';

type Row = {
  method: 'post' | 'patch' | 'put' | 'delete';
  path: (s: Shop) => string;
  perm: Permission;
  body?: (s: Shop) => object;
};

/** Every MUTATING endpoint. Branch routes use GUL. THIS LIST GROWS EVERY DAY. */
export const ROWS: Row[] = [
  {
    method: 'patch',
    path: () => '/api/settings',
    perm: 'settings:update',
    body: () => ({ taxLabel: 'VAT' }),
  },
  {
    method: 'post',
    path: () => '/api/branches',
    perm: 'branch:manage',
    body: () => ({ code: 'UTT', name: 'Uttara' }),
  },
  {
    method: 'patch',
    path: (s) => `/api/branches/${s.gul._id}`,
    perm: 'branch:manage',
    body: () => ({ phone: '01700000000' }),
  },
  {
    method: 'post',
    path: () => '/api/staff',
    perm: 'staff:manage',
    body: (s) => ({
      name: 'New',
      email: `n${Math.random()}@test.dev`,
      role: 'cashier',
      branchIds: [String(s.gul._id)],
      temporaryPassword: 'Passw0rd!',
    }),
  },
  // Day 7+: categories, products, adjustments, sales, returns, POs, transfers…
];

const ACTORS = ['owner', 'managerGul', 'cashierGul'] as const;
const roleOf = { owner: 'owner', managerGul: 'manager', cashierGul: 'cashier' } as const;

describe('RBAC matrix', () => {
  for (const row of ROWS) {
    for (const actor of ACTORS) {
      const allowed = can(roleOf[actor], row.perm);
      it(`${row.method.toUpperCase()} ${row.perm} as ${actor} → ${allowed ? 'allowed' : '403'}`, async () => {
        const s = await makeShop();
        const client = as(s[actor].token);
        const res = await client[row.method](row.path(s)).send(row.body?.(s) ?? {});
        if (allowed) expect([403, 404]).not.toContain(res.status);
        else expect(res.status).toBe(403);
      });
    }
  }

  // Turned on at the end of Day 19, when every mutating endpoint exists:
  it.todo('every non-view permission in PERMISSIONS appears in at least one row');
});
