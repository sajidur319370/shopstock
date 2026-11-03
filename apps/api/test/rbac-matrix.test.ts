import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { can, type Permission } from '@shopstock/shared';
import { as } from './helpers/auth';
import { makeShop, type Shop } from './factories/shop';
import { makeCategory, makeProduct } from './factories/catalog';
import { stockUp } from './factories/stock';

/** Ids a row needs that only exist after some setup (e.g. a product stocked at GUL). */
type Extra = Record<string, string>;

type Row = {
  method: 'post' | 'patch' | 'put' | 'delete';
  path: (s: Shop, x: Extra) => string;
  perm: Permission;
  body?: (s: Shop, x: Extra) => object;
  setup?: (s: Shop) => Promise<Extra>;
};

/** A product with 5 units at GUL (cost 100). */
async function stockedAtGul(s: Shop): Promise<Extra> {
  const cat = await makeCategory(s.owner.token);
  const p = await makeProduct(s.owner.token, { categoryId: cat.id });
  await stockUp(s.owner.token, 'GUL', [{ productId: p.id, qty: 5, unitCost: 100 }]);
  return { productId: p.id };
}

/** stockedAtGul + one unit sold by the Owner: a sale line to return. */
async function soldAtGul(s: Shop): Promise<Extra> {
  const { productId } = await stockedAtGul(s);
  const res = await as(s.owner.token)
    .post('/api/b/GUL/sales')
    .send({
      clientSaleId: randomUUID(),
      lines: [{ productId, qty: 1 }],
      payments: [{ method: 'cash', amount: 1_000_000 }],
    });
  return { saleId: res.body.sale.id, saleLineId: res.body.sale.items[0].id };
}

/** A supplier, a product and (unless 'none') a GUL PO of 5 in the given state, made by the Owner. */
const poAtGul =
  (state: 'none' | 'draft' | 'ordered' | 'partially_received') =>
  async (s: Shop): Promise<Extra> => {
    const cat = await makeCategory(s.owner.token);
    const p = await makeProduct(s.owner.token, { categoryId: cat.id });
    const sup = (
      await as(s.owner.token)
        .post('/api/suppliers')
        .send({ name: `Sup ${randomUUID()}` })
    ).body.supplier;
    const x: Extra = { supplierId: sup.id, productId: p.id };
    if (state === 'none') return x;
    const base = '/api/b/GUL/purchase-orders';
    const po = (
      await as(s.owner.token)
        .post(base)
        .send({ supplierId: sup.id, lines: [{ productId: p.id, orderedQty: 5, unitCost: 100 }] })
    ).body.purchaseOrder;
    if (state !== 'draft') await as(s.owner.token).post(`${base}/${po.id}/order`);
    if (state === 'partially_received') {
      await as(s.owner.token)
        .post(`${base}/${po.id}/receive`)
        .send({ clientReceiptId: randomUUID(), lines: [{ productId: p.id, qty: 1 }] });
    }
    return { ...x, poId: po.id };
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
  {
    method: 'post',
    path: () => '/api/categories',
    perm: 'catalog:manage',
    body: () => ({ name: `Cat ${Math.random()}` }),
  },
  {
    method: 'post',
    path: () => '/api/products',
    perm: 'catalog:manage',
    // An unknown category → 400 for allowed roles (still "not 403"); cashiers are stopped before validation.
    body: () => ({ sku: 'RBAC-1', name: 'Rbac', price: 100, categoryId: '0123456789abcdef01234567' }),
  },
  // Day 8: inventory
  {
    method: 'post',
    path: () => '/api/b/GUL/adjustments',
    perm: 'inventory:adjust',
    setup: stockedAtGul,
    body: (_s, x) => ({ reason: 'lost', lines: [{ productId: x.productId, qtyChange: -1 }] }),
  },
  {
    method: 'post',
    path: () => '/api/b/GUL/stock-counts',
    perm: 'inventory:adjust',
    setup: stockedAtGul,
    body: (_s, x) => ({ lines: [{ productId: x.productId, expectedQty: 5, countedQty: 4 }] }),
  },
  {
    method: 'patch',
    path: (_s, x) => `/api/b/GUL/inventory/${x.productId}`,
    perm: 'inventory:configure',
    setup: stockedAtGul,
    body: () => ({ reorderLevel: 3 }),
  },
  // Day 11: every role may sell
  {
    method: 'post',
    path: () => '/api/b/GUL/sales',
    perm: 'sale:create',
    setup: stockedAtGul,
    body: (_s, x) => ({
      clientSaleId: randomUUID(),
      lines: [{ productId: x.productId, qty: 1 }],
      payments: [{ method: 'cash', amount: 1_000_000 }],
    }),
  },
  // Day 14: returns (Manager+)
  {
    method: 'post',
    path: () => '/api/b/GUL/returns',
    perm: 'return:create',
    setup: soldAtGul,
    body: (_s, x) => ({
      clientReturnId: randomUUID(),
      saleId: x.saleId,
      reason: 'changed_mind',
      lines: [{ saleLineId: x.saleLineId, qty: 1, restock: true }],
    }),
  },
  // Day 15: suppliers & purchase orders (Manager+)
  {
    method: 'post',
    path: () => '/api/suppliers',
    perm: 'supplier:manage',
    body: () => ({ name: `Sup ${Math.random()}` }),
  },
  {
    method: 'patch',
    path: (_s, x) => `/api/suppliers/${x.supplierId}`,
    perm: 'supplier:manage',
    setup: poAtGul('none'),
    body: () => ({ phone: '01700000000' }),
  },
  {
    method: 'post',
    path: () => '/api/b/GUL/purchase-orders',
    perm: 'po:manage',
    setup: poAtGul('none'),
    body: (_s, x) => ({
      supplierId: x.supplierId,
      lines: [{ productId: x.productId, orderedQty: 1, unitCost: 100 }],
    }),
  },
  ...(['patch', 'delete'] as const).map((method): Row => ({
    method,
    path: (_s, x) => `/api/b/GUL/purchase-orders/${x.poId}`,
    perm: 'po:manage',
    setup: poAtGul('draft'),
    body: () => ({ notes: 'rbac' }),
  })),
  ...(['order', 'cancel'] as const).map((action): Row => ({
    method: 'post',
    path: (_s, x) => `/api/b/GUL/purchase-orders/${x.poId}/${action}`,
    perm: 'po:manage',
    setup: poAtGul('draft'),
  })),
  {
    method: 'post',
    path: (_s, x) => `/api/b/GUL/purchase-orders/${x.poId}/close`,
    perm: 'po:manage',
    setup: poAtGul('partially_received'),
  },
  {
    method: 'post',
    path: (_s, x) => `/api/b/GUL/purchase-orders/${x.poId}/receive`,
    perm: 'po:receive',
    setup: poAtGul('ordered'),
    body: (_s, x) => ({ clientReceiptId: randomUUID(), lines: [{ productId: x.productId, qty: 1 }] }),
  },
  // Day 17+: transfers…
];

const ACTORS = ['owner', 'managerGul', 'cashierGul'] as const;
const roleOf = { owner: 'owner', managerGul: 'manager', cashierGul: 'cashier' } as const;

describe('RBAC matrix', () => {
  for (const row of ROWS) {
    for (const actor of ACTORS) {
      const allowed = can(roleOf[actor], row.perm);
      it(`${row.method.toUpperCase()} ${row.perm} as ${actor} → ${allowed ? 'allowed' : '403'}`, async () => {
        const s = await makeShop();
        const x = (await row.setup?.(s)) ?? {};
        const client = as(s[actor].token);
        const res = await client[row.method](row.path(s, x)).send(row.body?.(s, x) ?? {});
        if (allowed) expect([403, 404]).not.toContain(res.status);
        else expect(res.status).toBe(403);
      });
    }
  }

  // Turned on at the end of Day 19, when every mutating endpoint exists:
  it.todo('every non-view permission in PERMISSIONS appears in at least one row');
});
