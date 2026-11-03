import { describe, expect, it } from 'vitest';
import { as } from './helpers/auth';
import { sell, shopWithStock } from './factories/sales';

/** Any key that reveals what goods cost the shop (NFR-SEC-14). */
const COST_KEYS = new Set([
  'avgCost',
  'unitCost',
  'cost',
  'costRestocked',
  'writeOff',
  'writeOffCost',
  'valueChange',
  'value',
  'stockValue',
  'profit',
  'grossProfit',
  'cogs',
  'marginBps',
  'lastCost',
]);

function costPaths(v: unknown, path = '$'): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => costPaths(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => [
      ...(COST_KEYS.has(k) ? [`${path}.${k}`] : []),
      ...costPaths(x, `${path}.${k}`),
    ]);
  }
  return [];
}

describe('cost confidentiality (NFR-SEC-14)', () => {
  /** Every GET a cashier can make. When you add one (can('cashier', perm)), add it here. */
  it('a cashier never receives a cost field', async () => {
    const s = await shopWithStock(3); // 3 of reorder 5: on the low-stock list too
    const sale = (await sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 1 }])).body.sale;
    const paths = [
      '/api/me',
      '/api/settings',
      '/api/categories',
      '/api/products',
      `/api/products/${s.product.id}`,
      '/api/products/search?q=Soy',
      '/api/b/GUL',
      '/api/b/GUL/pos/search?q=Soy',
      '/api/b/GUL/inventory',
      `/api/b/GUL/inventory/${s.product.id}`,
      '/api/b/GUL/sales',
      `/api/b/GUL/sales/${sale.id}`,
      `/api/b/GUL/sales/by-invoice/${sale.invoiceNo}`,
      '/api/b/GUL/sales/my-summary',
      '/api/b/GUL/dashboard',
      '/api/b/GUL/low-stock',
    ];
    for (const p of paths) {
      const res = await as(s.cashierGul.token).get(p);
      expect(res.status, p).toBe(200);
      expect(costPaths(res.body), p).toEqual([]);
    }
  });

  it('the same data DOES carry costs for a manager (the test above is not vacuous)', async () => {
    const s = await shopWithStock(10);
    const sale = (await sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 1 }])).body.sale;
    for (const p of [
      `/api/b/GUL/sales/${sale.id}`,
      '/api/b/GUL/inventory',
      `/api/products/${s.product.id}`,
    ]) {
      const res = await as(s.managerGul.token).get(p);
      expect(costPaths(res.body).length, p).toBeGreaterThan(0);
    }
  });
});
