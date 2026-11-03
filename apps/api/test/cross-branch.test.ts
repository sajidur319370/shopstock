import { beforeEach, describe, expect, it } from 'vitest';
import { as } from './helpers/auth';
import { makeShop, type Shop } from './factories/shop';

/** Any well-formed id: resolveBranch must answer 404 BEFORE anything looks at it. */
const FAKE_ID = '0123456789abcdef01234567';

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
  // Day 8: inventory & stock
  { name: 'inventory list', method: 'get', path: () => '/api/b/DHN/inventory' },
  { name: 'inventory row', method: 'get', path: () => `/api/b/DHN/inventory/${FAKE_ID}` },
  {
    name: 'reorder level',
    method: 'patch',
    path: () => `/api/b/DHN/inventory/${FAKE_ID}`,
    body: () => ({ reorderLevel: 1 }),
  },
  {
    name: 'adjustment',
    method: 'post',
    path: () => '/api/b/DHN/adjustments',
    body: () => ({ reason: 'lost', lines: [{ productId: FAKE_ID, qtyChange: -1 }] }),
  },
  {
    name: 'stock count',
    method: 'post',
    path: () => '/api/b/DHN/stock-counts',
    body: () => ({ lines: [{ productId: FAKE_ID, expectedQty: 0, countedQty: 1, unitCost: 1 }] }),
  },
  { name: 'movements', method: 'get', path: () => '/api/b/DHN/movements' },
  { name: 'reconcile', method: 'get', path: () => '/api/b/DHN/reconcile' },
  // Day 11: sales & POS
  {
    name: 'create sale',
    method: 'post',
    path: () => '/api/b/DHN/sales',
    body: () => ({
      clientSaleId: '3f2b1a4c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
      lines: [{ productId: FAKE_ID, qty: 1 }],
      payments: [{ method: 'cash', amount: 100 }],
    }),
  },
  { name: 'POS search', method: 'get', path: () => '/api/b/DHN/pos/search?q=oil' },
  // Day 13: sales history, detail, print count, shift (a DHN sale via GUL's URL: sales.history.test.ts)
  { name: 'sales history', method: 'get', path: () => '/api/b/DHN/sales' },
  { name: 'sale detail', method: 'get', path: () => `/api/b/DHN/sales/${FAKE_ID}` },
  { name: 'sale by invoice', method: 'get', path: () => '/api/b/DHN/sales/by-invoice/DHN-000001' },
  { name: 'mark printed', method: 'post', path: () => `/api/b/DHN/sales/${FAKE_ID}/printed` },
  { name: 'my shift summary', method: 'get', path: () => '/api/b/DHN/sales/my-summary' },
  // Day 14: returns (a GUL return via DHN's URL, as the Owner: returns.test.ts)
  {
    name: 'create return',
    method: 'post',
    path: () => '/api/b/DHN/returns',
    body: () => ({
      clientReturnId: '3f2b1a4c-5d6e-4f70-8a9b-0c1d2e3f4a5c',
      saleId: FAKE_ID,
      reason: 'changed_mind',
      lines: [{ saleLineId: FAKE_ID, qty: 1, restock: true }],
    }),
  },
  { name: 'returns list', method: 'get', path: () => '/api/b/DHN/returns' },
  { name: 'return detail', method: 'get', path: () => `/api/b/DHN/returns/${FAKE_ID}` },
  // Day 15: purchase orders (a DHN PO via GUL's URL: purchasing.test.ts)
  { name: 'PO list', method: 'get', path: () => '/api/b/DHN/purchase-orders' },
  { name: 'PO suggestions', method: 'get', path: () => '/api/b/DHN/purchase-orders/suggestions' },
  { name: 'PO detail', method: 'get', path: () => `/api/b/DHN/purchase-orders/${FAKE_ID}` },
  {
    name: 'create PO',
    method: 'post',
    path: () => '/api/b/DHN/purchase-orders',
    body: () => ({ supplierId: FAKE_ID, lines: [{ productId: FAKE_ID, orderedQty: 1, unitCost: 1 }] }),
  },
  {
    name: 'edit PO',
    method: 'patch',
    path: () => `/api/b/DHN/purchase-orders/${FAKE_ID}`,
    body: () => ({ notes: 'x' }),
  },
  { name: 'delete PO', method: 'delete', path: () => `/api/b/DHN/purchase-orders/${FAKE_ID}` },
  { name: 'order PO', method: 'post', path: () => `/api/b/DHN/purchase-orders/${FAKE_ID}/order` },
  { name: 'cancel PO', method: 'post', path: () => `/api/b/DHN/purchase-orders/${FAKE_ID}/cancel` },
  { name: 'close PO', method: 'post', path: () => `/api/b/DHN/purchase-orders/${FAKE_ID}/close` },
  {
    name: 'receive PO',
    method: 'post',
    path: () => `/api/b/DHN/purchase-orders/${FAKE_ID}/receive`,
    body: () => ({
      clientReceiptId: '3f2b1a4c-5d6e-4f70-8a9b-0c1d2e3f4a5d',
      lines: [{ productId: FAKE_ID, qty: 1 }],
    }),
  },
  // Day 17: transfers (GUL→DHN receive as GUL staff, DHN→UTT from GUL: transfers.test.ts)
  { name: 'transfers list', method: 'get', path: () => '/api/b/DHN/transfers' },
  { name: 'transfer destinations', method: 'get', path: () => '/api/b/DHN/transfers/destinations' },
  { name: 'transfer detail', method: 'get', path: () => `/api/b/DHN/transfers/${FAKE_ID}` },
  {
    name: 'create transfer',
    method: 'post',
    path: () => '/api/b/DHN/transfers',
    body: () => ({ toBranchCode: 'GUL', lines: [{ productId: FAKE_ID, qty: 1 }] }),
  },
  { name: 'dispatch transfer', method: 'post', path: () => `/api/b/DHN/transfers/${FAKE_ID}/dispatch` },
  { name: 'receive transfer', method: 'post', path: () => `/api/b/DHN/transfers/${FAKE_ID}/receive` },
  { name: 'cancel transfer', method: 'post', path: () => `/api/b/DHN/transfers/${FAKE_ID}/cancel` },
  // Day 18+: dashboard…
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
