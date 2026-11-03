import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  BranchDashboardDto,
  LowStockListDto,
  OverviewDto,
  SaleDto,
  ShiftDashboardDto,
} from '@shopstock/shared';
import { invalidateCache } from '../src/lib/cache';
import { createSale } from '../src/modules/sales/sale.service';
import { as } from './helpers/auth';
import { ownerCtxFor } from './helpers/ctx';
import { makeCategory, makeProduct } from './factories/catalog';
import { makeSupplier, orderedPO, draftPO, receive } from './factories/purchasing';
import { sell, shopWithStock } from './factories/sales';
import type { Shop } from './factories/shop';
import { stockUp } from './factories/stock';
import { dispatch, makeTransfer } from './factories/transfers';

const dash = async (token: string, code = 'GUL') =>
  (await as(token).get(`/api/b/${code}/dashboard`)).body as BranchDashboardDto;

describe('branch dashboard (FR-DSH-01)', () => {
  it('today in one $facet: totals, cash collected, refunds, recent, hour in shop time', async () => {
    const s = await shopWithStock(20, { price: 18500 });
    await as(s.owner.token).patch('/api/settings').send({ taxRateBps: 0 });
    invalidateCache();

    await sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 2 }], {
      payments: [{ method: 'cash', amount: 50000 }],
    });
    const b = (
      await sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 1 }], {
        payments: [{ method: 'card', amount: 18500 }],
      })
    ).body.sale as SaleDto;
    await as(s.managerGul.token)
      .post('/api/b/GUL/returns')
      .send({
        clientReturnId: randomUUID(),
        saleId: b.id,
        reason: 'changed_mind',
        lines: [{ saleLineId: b.items[0]!.id, qty: 1, restock: true }],
      });

    const d = await dash(s.managerGul.token);
    expect(d.kind).toBe('branch');
    expect(d.sales).toEqual({ count: 2, net: 55500, total: 55500, avgBasket: 27750 });
    expect(d.byMethod).toEqual({ cash: 37000, card: 18500, mobile: 0 }); // cash = 50000 tendered − 13000 change
    expect(d.refunds).toEqual({ count: 1, amount: 18500 });
    expect(d.recentSales.map((r) => r.invoiceNo)).toEqual([b.invoiceNo, 'GUL-000001']);
    expect(d.recentSales[0]).toMatchObject({ total: 18500, cashierName: expect.stringMatching(/cashier/) });

    const hourInDhaka = Number(
      new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Dhaka' }).format(
        new Date(),
      ),
    );
    expect(d.byHour[hourInDhaka]).toEqual({ hour: hourInDhaka, count: 2, total: 55500 });
    expect(d.byHour.reduce((n, h) => n + h.count, 0)).toBe(2);
    expect(JSON.stringify(d)).not.toMatch(/unitCost|avgCost|"cost"/); // no money analysis here
  });

  it('before the first sale: zeros, not missing fields', async () => {
    const s = await shopWithStock(5);
    const d = await dash(s.managerGul.token);
    expect(d.sales).toEqual({ count: 0, net: 0, total: 0, avgBasket: 0 });
    expect(d.byMethod).toEqual({ cash: 0, card: 0, mobile: 0 });
    expect(d.refunds).toEqual({ count: 0, amount: 0 });
    expect(d.byHour).toHaveLength(24);
    expect(d.byHour.every((h, i) => h.hour === i && h.count === 0 && h.total === 0)).toBe(true);
    expect(d.recentSales).toEqual([]);
    expect(d).toMatchObject({ incomingTransfers: [], outgoingPending: 0, openPOs: [] });
  });

  it("yesterday's sale is not in today's numbers", async () => {
    const s = await shopWithStock(10, { price: 1000 });
    const yesterday = new Date(Date.now() - 26 * 3_600_000); // > 24 h: a different business date in any tz
    const ctx = await ownerCtxFor(s.gul._id, 'GUL', () => yesterday);
    await createSale(ctx, {
      clientSaleId: randomUUID(),
      lines: [{ productId: s.product.id, qty: 1 }],
      payments: [{ method: 'cash', amount: 100_000 }],
    });
    await sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 2 }]);
    const d = await dash(s.managerGul.token);
    expect(d.sales.count).toBe(1);
    expect(d.recentSales).toHaveLength(1);
  });

  it('low and out counts, the 10 lowest by quantity ÷ reorder level', async () => {
    const s = await shopWithStock(2); // the factory product: reorder level 5 → 2/5 = 0.4, low
    const cat = s.product.categoryId;
    const mk = (name: string, reorderLevel = 5) =>
      makeProduct(s.owner.token, { categoryId: cat, name, reorderLevel });
    const [out, fine, noAlert, archived, nearly] = [
      await mk('Gone'),
      await mk('Plenty'),
      await mk('No alert', 0),
      await mk('Archived'),
      await mk('Nearly', 5),
    ];
    await mk('Never stocked here'); // no row at GUL: never "out" here (FR-DSH-06)
    await stockUp(s.owner.token, 'GUL', [
      { productId: out.id, qty: 3, unitCost: 1 },
      { productId: fine.id, qty: 50, unitCost: 1 },
      { productId: noAlert.id, qty: 1, unitCost: 1 },
      { productId: archived.id, qty: 1, unitCost: 1 },
      { productId: nearly.id, qty: 4, unitCost: 1 },
    ]);
    await sell(s.cashierGul.token, 'GUL', [{ productId: out.id, qty: 3 }]); // → 0: out
    await as(s.owner.token).patch(`/api/products/${archived.id}`).send({ isActive: false });

    const { lowStock } = await dash(s.managerGul.token);
    expect({ low: lowStock.lowCount, out: lowStock.outCount }).toEqual({ low: 2, out: 1 });
    expect(lowStock.top.map((r) => [r.name, r.status, r.quantity])).toEqual([
      ['Gone', 'out', 0], // ratio 0
      ['Soybean Oil 1L', 'low', 2], // 0.4
      ['Nearly', 'low', 4], // 0.8
    ]);
  });

  it('incoming in-transit and outgoing pending transfers', async () => {
    const s = await shopWithStock(10);
    const sent = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 4 }]);
    await dispatch(s.managerGul.token, 'GUL', sent.id);
    await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 1 }]); // pending

    const dhn = await dash(s.managerDhn.token, 'DHN');
    expect(dhn.incomingTransfers).toEqual([
      expect.objectContaining({ id: sent.id, transferNo: sent.transferNo, fromCode: 'GUL', units: 4 }),
    ]);
    expect(dhn.outgoingPending).toBe(0);
    const gul = await dash(s.managerGul.token);
    expect(gul.outgoingPending).toBe(1); // the pending one; the dispatched one isn't pending
    expect(gul.incomingTransfers).toEqual([]);
  });

  it('open POs: ordered and partially received, not draft or received', async () => {
    const s = await shopWithStock(0);
    const sup = await makeSupplier(s.owner.token);
    const line = [{ productId: s.product.id, orderedQty: 5, unitCost: 100 }];
    await draftPO(s.managerGul.token, 'GUL', sup.id, line);
    const ordered = await orderedPO(s.managerGul.token, 'GUL', sup.id, line);
    const partial = await orderedPO(s.managerGul.token, 'GUL', sup.id, line);
    await receive(s.managerGul.token, 'GUL', partial.id, [{ productId: s.product.id, qty: 2 }]);
    const done = await orderedPO(s.managerGul.token, 'GUL', sup.id, line);
    await receive(s.managerGul.token, 'GUL', done.id, [{ productId: s.product.id, qty: 5 }]);

    const { openPOs } = await dash(s.managerGul.token);
    expect(openPOs.map((p) => [p.poNumber, p.status])).toEqual([
      [partial.poNumber, 'partially_received'],
      [ordered.poNumber, 'ordered'],
    ]);
  });
});

describe('cashier dashboard (FR-DSH-02)', () => {
  it('a cashier gets only their own shift and the low-stock count', async () => {
    const s = await shopWithStock(3, { price: 1000 }); // 3 of reorder 5: already low
    await sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 1 }]);
    await sell(s.managerGul.token, 'GUL', [{ productId: s.product.id, qty: 1 }]);
    const res = await as(s.cashierGul.token).get('/api/b/GUL/dashboard');
    const d = res.body as ShiftDashboardDto;
    expect(d.kind).toBe('shift');
    expect(d.shift).toMatchObject({ count: 1, total: 1050 });
    expect(d.lowStockCount).toBe(1);
    expect(Object.keys(d).sort()).toEqual(['kind', 'lowStockCount', 'shift', 'today']);
    expect(JSON.stringify(d)).not.toMatch(/recentSales|cashierName|manager/);
  });
});

describe('overview (FR-DSH-03)', () => {
  async function twoBranches(): Promise<Shop & { product: { id: string } }> {
    const s = await shopWithStock(10, { price: 1000 });
    await stockUp(s.owner.token, 'DHN', [{ productId: s.product.id, qty: 2, unitCost: 100 }]); // low at DHN
    await sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 1 }]);
    await sell(s.cashierDhn.token, 'DHN', [{ productId: s.product.id, qty: 1 }]);
    await sell(s.cashierDhn.token, 'DHN', [{ productId: s.product.id, qty: 1 }]); // DHN now out (0)
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 2 }]);
    await dispatch(s.managerGul.token, 'GUL', t.id);
    return s;
  }

  it('as the Owner: rows for GUL and DHN + totals', async () => {
    const s = await twoBranches();
    const o = (await as(s.owner.token).get('/api/dashboard/overview')).body as OverviewDto;
    expect(
      o.branches.map((b) => [b.code, b.sales.count, b.lowCount, b.outCount, b.incomingTransfers]),
    ).toEqual([
      ['DHN', 2, 0, 1, 1],
      ['GUL', 1, 0, 0, 0],
    ]);
    expect(o.totals).toEqual({
      sales: { count: 3, net: 3000, total: 3150 },
      lowCount: 0,
      outCount: 1,
      incomingTransfers: 1,
    });
  });

  it("as DHN's manager: only DHN; as a cashier: 403", async () => {
    const s = await twoBranches();
    const o = (await as(s.managerDhn.token).get('/api/dashboard/overview')).body as OverviewDto;
    expect(o.branches.map((b) => b.code)).toEqual(['DHN']);
    expect(o.totals.sales.count).toBe(2);
    expect((await as(s.cashierGul.token).get('/api/dashboard/overview')).status).toBe(403);
  });
});

describe('low-stock list (FR-DSH-05)', () => {
  it('status=out returns only out rows, each with suggestedQty; cashiers may read it', async () => {
    const s = await shopWithStock(2); // low (2 of 5)
    const gone = await makeProduct(s.owner.token, {
      categoryId: s.product.categoryId,
      name: 'Gone',
      reorderLevel: 4,
    });
    await stockUp(s.owner.token, 'GUL', [{ productId: gone.id, qty: 1, unitCost: 1 }]);
    await sell(s.cashierGul.token, 'GUL', [{ productId: gone.id, qty: 1 }]);

    const all = (await as(s.cashierGul.token).get('/api/b/GUL/low-stock')).body as LowStockListDto;
    expect(all.items.map((r) => [r.name, r.status, r.suggestedQty])).toEqual([
      ['Gone', 'out', 8], // max(2 × 4 − 0, 1)
      ['Soybean Oil 1L', 'low', 8], // max(2 × 5 − 2, 1)
    ]);
    expect(all.truncated).toBe(false);
    const out = (await as(s.managerGul.token).get('/api/b/GUL/low-stock?status=out')).body as LowStockListDto;
    expect(out.items.map((r) => r.name)).toEqual(['Gone']);
    const otherCat = await makeCategory(s.owner.token);
    const none = await as(s.managerGul.token).get(`/api/b/GUL/low-stock?categoryId=${otherCat.id}`);
    expect(none.body.items).toEqual([]);
    expect((await as(s.managerGul.token).get('/api/b/GUL/low-stock?status=soon')).status).toBe(400);
    expect(JSON.stringify(all)).not.toMatch(/cost/i);
  });
});

describe('access changes while the page is open (E6)', () => {
  it('after the Owner removes GUL from the manager, their next dashboard call is 404', async () => {
    const s = await shopWithStock(1);
    expect((await as(s.managerGul.token).get('/api/b/GUL/dashboard')).status).toBe(200);
    const res = await as(s.owner.token)
      .patch(`/api/staff/${s.managerGul.user._id}`)
      .send({ branchIds: [String(s.dhn._id)] });
    expect(res.status).toBe(200);
    expect((await as(s.managerGul.token).get('/api/b/GUL/dashboard')).status).toBe(404);
    expect((await as(s.managerGul.token).get('/api/b/DHN/dashboard')).status).toBe(200);
  });
});
