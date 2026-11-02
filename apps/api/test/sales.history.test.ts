import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SaleRowDto } from '@shopstock/shared';
import { as, makeUser } from './helpers/auth';
import { ownerCtxFor } from './helpers/ctx';
import { sell, shopWithStock } from './factories/sales';
import { stockUp } from './factories/stock';
import { createSale } from '../src/modules/sales/sale.service';

const oil = (s: { product: { id: string } }, qty = 1) => [{ productId: s.product.id, qty }];

/** Asserts 201 and returns the sale. */
async function sold(token: string, code: string, lines: { productId: string; qty: number }[], opts = {}) {
  const res = await sell(token, code, lines, opts);
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.sale as { id: string; invoiceNo: string };
}

const list = (token: string, query = '') => as(token).get(`/api/b/GUL/sales${query}`);
const invoices = (items: SaleRowDto[]) => items.map((r) => r.invoiceNo);

describe('sale visibility (FR-SAL-10/11)', () => {
  it("AC-SAL-05: a cashier gets 404 for another cashier's sale; their manager gets it", async () => {
    const s = await shopWithStock(10);
    const cashierB = await makeUser('cashier', [s.gul._id]);
    const saleB = await sold(cashierB.token, 'GUL', oil(s));

    const byA = await as(s.cashierGul.token).get(`/api/b/GUL/sales/${saleB.id}`);
    expect(byA.status).toBe(404);
    expect(byA.body.error.code).toBe('NOT_FOUND'); // the same answer as "no such sale"
    expect((await as(s.cashierGul.token).get(`/api/b/GUL/sales/by-invoice/${saleB.invoiceNo}`)).status).toBe(
      404,
    );
    expect((await as(s.cashierGul.token).post(`/api/b/GUL/sales/${saleB.id}/printed`)).status).toBe(404);

    const byManager = await as(s.managerGul.token).get(`/api/b/GUL/sales/${saleB.id}`);
    expect(byManager.status).toBe(200);
    expect(byManager.body.sale.invoiceNo).toBe(saleB.invoiceNo);
    expect(byManager.body.sale.items[0].unitCost).toBe(16000); // Manager+ sees cost
  });

  it('a cashier sees their OWN sale in full, but never cost', async () => {
    const s = await shopWithStock(10);
    const sale = await sold(s.cashierGul.token, 'GUL', oil(s, 2));
    const res = await as(s.cashierGul.token).get(`/api/b/GUL/sales/${sale.id}`);
    expect(res.status).toBe(200);
    expect(res.body.sale.totals).toMatchObject({ subtotal: 37000, tax: 1850, total: 38850 });
    expect(JSON.stringify(res.body)).not.toMatch(/unitCost|"cost"/);
  });

  it('by-invoice: found case-insensitively; malformed ids are 400', async () => {
    const s = await shopWithStock(10);
    const sale = await sold(s.managerGul.token, 'GUL', oil(s));
    const res = await as(s.managerGul.token).get(
      `/api/b/GUL/sales/by-invoice/${sale.invoiceNo.toLowerCase()}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.sale.id).toBe(sale.id);
    expect((await as(s.managerGul.token).get('/api/b/GUL/sales/not-an-id')).status).toBe(400);
  });

  it("a DHN sale through GUL's URL is a 404 (wrong branch in the path), even for the Owner", async () => {
    const s = await shopWithStock(10);
    await stockUp(s.owner.token, 'DHN', [{ productId: s.product.id, qty: 5, unitCost: 16000 }]);
    const dhnSale = await sold(s.managerDhn.token, 'DHN', oil(s));

    for (const token of [s.owner.token, s.managerGul.token]) {
      expect((await as(token).get(`/api/b/GUL/sales/${dhnSale.id}`)).status).toBe(404);
      expect((await as(token).get(`/api/b/GUL/sales/by-invoice/${dhnSale.invoiceNo}`)).status).toBe(404);
      expect((await as(token).post(`/api/b/GUL/sales/${dhnSale.id}/printed`)).status).toBe(404);
    }
    // GUL staff can't reach it through DHN's URL either (resolveBranch)
    expect((await as(s.managerGul.token).get(`/api/b/DHN/sales/${dhnSale.id}`)).status).toBe(404);
    // …while the Owner, through the right URL, can
    expect((await as(s.owner.token).get(`/api/b/DHN/sales/${dhnSale.id}`)).status).toBe(200);
  });
});

describe('sales history list', () => {
  it("cashiers see only their own (a cashierId filter can't widen it); managers see the branch, not DHN", async () => {
    const s = await shopWithStock(20);
    await stockUp(s.owner.token, 'DHN', [{ productId: s.product.id, qty: 5, unitCost: 16000 }]);
    const mine = await sold(s.cashierGul.token, 'GUL', oil(s));
    const managers = await sold(s.managerGul.token, 'GUL', oil(s));
    await sold(s.managerDhn.token, 'DHN', oil(s));

    const own = await list(s.cashierGul.token);
    expect(own.status).toBe(200);
    expect(invoices(own.body.items)).toEqual([mine.invoiceNo]);
    const sneaky = await list(s.cashierGul.token, `?cashierId=${s.managerGul.user._id}`);
    expect(invoices(sneaky.body.items)).toEqual([mine.invoiceNo]);

    const all = await list(s.managerGul.token);
    expect(invoices(all.body.items)).toEqual([managers.invoiceNo, mine.invoiceNo]); // newest first
    expect(all.body.items.every((r: SaleRowDto) => r.invoiceNo.startsWith('GUL-'))).toBe(true);
    expect(all.body.items[0]).toMatchObject({
      cashierName: s.managerGul.user.name,
      total: 19425,
      itemCount: 1,
      methods: ['cash'],
      returnStatus: 'none',
    });
    expect(all.body.items[0]).not.toHaveProperty('items'); // rows have no lines

    const oneCashier = await list(s.managerGul.token, `?cashierId=${s.cashierGul.user._id}`);
    expect(invoices(oneCashier.body.items)).toEqual([mine.invoiceNo]);
  });

  it('60 sales → 50 + cursor, then 10 + null; a sale made in between causes no duplicates', async () => {
    const s = await shopWithStock(100);
    const all: string[] = [];
    for (let i = 0; i < 60; i++) all.push((await sold(s.managerGul.token, 'GUL', oil(s))).invoiceNo);

    const p1 = await list(s.managerGul.token);
    expect(p1.body.items).toHaveLength(50);
    expect(p1.body.nextCursor).toEqual(expect.any(String));

    await sold(s.managerGul.token, 'GUL', oil(s)); // arrives while the user reads page 1

    const p2 = await list(s.managerGul.token, `?cursor=${p1.body.nextCursor}`);
    expect(p2.body.items).toHaveLength(10);
    expect(p2.body.nextCursor).toBeNull();

    const seen = [...invoices(p1.body.items), ...invoices(p2.body.items)];
    expect(new Set(seen).size).toBe(60);
    expect(seen).toEqual(all.reverse()); // exactly the original 60, newest first
  }, 60_000);

  it('a tampered cursor is a 400, not a 500', async () => {
    const s = await shopWithStock(1);
    const res = await list(s.managerGul.token, '?cursor=bm90LWEtY3Vyc29y');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });

  it('filters: business-date range, payment method, invoice number', async () => {
    const s = await shopWithStock(20);
    const card = await sold(s.managerGul.token, 'GUL', oil(s), {
      payments: [{ method: 'card', amount: 19425, reference: '4242' }],
    });
    for (let i = 0; i < 4; i++) await sold(s.managerGul.token, 'GUL', oil(s)); // GUL-000002..5
    // Then three shop days in Dhaka, in the FUTURE and LAST: reconciliation expects the newest
    // movement to carry the current quantity, so a dated sale can't come before a "now" one.
    for (const day of ['2030-01-10', '2030-01-11', '2030-01-12']) {
      const ctx = await ownerCtxFor(s.gul._id, 'GUL', () => new Date(`${day}T06:00:00Z`));
      await createSale(ctx, {
        clientSaleId: randomUUID(),
        lines: oil(s),
        payments: [{ method: 'cash', amount: 1_000_000 }],
      }); // GUL-000006..8
    }

    const range = await list(s.managerGul.token, '?from=2030-01-11&to=2030-01-12');
    expect(range.body.items.map((r: SaleRowDto) => r.businessDate)).toEqual(['2030-01-12', '2030-01-11']);

    const byCard = await list(s.managerGul.token, '?method=card');
    expect(invoices(byCard.body.items)).toEqual([card.invoiceNo]);
    expect(byCard.body.items[0].methods).toEqual(['card']);

    const one = await list(s.managerGul.token, '?invoiceNo=gul-000007');
    expect(invoices(one.body.items)).toEqual(['GUL-000007']);

    expect((await list(s.managerGul.token, '?returnStatus=full')).body.items).toEqual([]);
    expect((await list(s.managerGul.token, '?method=bitcoin')).status).toBe(400);
  });
});

describe('printing and the shift summary', () => {
  it('FR-IVC-04: the first print is the original, every later one is a COPY', async () => {
    const s = await shopWithStock(5);
    const sale = await sold(s.cashierGul.token, 'GUL', oil(s));
    const print = () => as(s.cashierGul.token).post(`/api/b/GUL/sales/${sale.id}/printed`);
    expect((await print()).body).toEqual({ copy: false });
    expect((await print()).body).toEqual({ copy: true });
    expect((await print()).body).toEqual({ copy: true });
    const detail = await as(s.cashierGul.token).get(`/api/b/GUL/sales/${sale.id}`);
    expect(detail.body.sale.printCount).toBe(3);
  });

  it('two first prints at once: exactly one original ($inc is atomic)', async () => {
    const s = await shopWithStock(5);
    const sale = await sold(s.managerGul.token, 'GUL', oil(s));
    const results = await Promise.all(
      Array.from({ length: 5 }, () => as(s.managerGul.token).post(`/api/b/GUL/sales/${sale.id}/printed`)),
    );
    expect(results.filter((r) => r.body.copy === false)).toHaveLength(1);
  });

  it('my-summary: 3 cash sales of 38850, tendered 50000 → cash collected 116550 (not 150000)', async () => {
    const s = await shopWithStock(20);
    for (let i = 0; i < 3; i++)
      await sold(s.cashierGul.token, 'GUL', oil(s, 2), { payments: [{ method: 'cash', amount: 50000 }] });
    await sold(s.cashierGul.token, 'GUL', oil(s), {
      payments: [
        { method: 'cash', amount: 10000 },
        { method: 'card', amount: 9425 },
      ],
    });
    await sold(s.managerGul.token, 'GUL', oil(s)); // someone else's: not in MY shift

    const res = await as(s.cashierGul.token).get('/api/b/GUL/sales/my-summary');
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      count: 4,
      total: 3 * 38850 + 19425,
      items: 7,
      byMethod: { cash: 116550 + 10000, card: 9425 },
    });
    expect(res.body.summary.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('my-summary with no sales today is all zeros', async () => {
    const s = await shopWithStock(0);
    const res = await as(s.cashierGul.token).get('/api/b/GUL/sales/my-summary');
    expect(res.body.summary).toMatchObject({ count: 0, total: 0, items: 0, byMethod: {} });
  });
});
