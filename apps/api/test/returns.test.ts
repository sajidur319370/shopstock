import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { addDaysToDate, toBusinessDate, type ReturnDto, type SaleDto } from '@shopstock/shared';
import { Inventory, Sale, SaleReturn, StockMovement } from '../src/db/models';
import { invalidateCache } from '../src/lib/cache';
import { as } from './helpers/auth';
import { makeProduct } from './factories/catalog';
import { sell, shopWithStock } from './factories/sales';
import type { Shop } from './factories/shop';
import { stockUp } from './factories/stock';

const repeats = Number(process.env.REPEATS ?? 5);

/** A line whose total isn't divisible by its qty: price 952 × 3 = 2856 net, 5% tax = 143, total 2999. */
async function soldThree(opts: Parameters<typeof sell>[3] = {}) {
  const s = await shopWithStock(10, { price: 952, cost: 600 });
  await as(s.owner.token).patch('/api/settings').send({ taxRateBps: 500 });
  invalidateCache();
  const res = await sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 3 }], opts);
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  const sale = res.body.sale as SaleDto;
  return { s, sale, line: sale.items[0]! };
}

const ret = (s: Shop, saleId: string, lineId: string, qty: number, restock = true) =>
  as(s.managerGul.token)
    .post('/api/b/GUL/returns')
    .send({
      clientReturnId: randomUUID(),
      saleId,
      reason: 'changed_mind',
      lines: [{ saleLineId: lineId, qty, restock }],
    });

const getSale = async (s: Shop, id: string) =>
  (await as(s.managerGul.token).get(`/api/b/GUL/sales/${id}`)).body.sale as SaleDto;
const gulQty = async (s: Shop) => (await Inventory.findOne({ branchId: s.gul._id }).lean())!.quantity;

describe('returns: refunds (FR-RET-04)', () => {
  it('one unit at a time refunds portions that add up to the line total (AC-RET-02)', async () => {
    const { s, sale, line } = await soldThree();
    expect(line.total).toBe(2999);
    const r: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await ret(s, sale.id, line.id, 1);
      expect(res.status).toBe(201);
      r.push((res.body.return as ReturnDto).totals.total);
    }
    expect(r).toEqual([1000, 999, 1000]); // round(2999/3)=1000, round(5998/3)=1999 → 999, 2999 − 1999 = 1000
    expect(r.reduce((a, b) => a + b, 0)).toBe(2999);
    const after = await getSale(s, sale.id);
    expect(after.returnStatus).toBe('full');
    expect(after.items[0]!.returnedQty).toBe(3);
  });

  it('partial then full: net, tax and total each add up to the sale exactly (discounts included)', async () => {
    const s = await shopWithStock(0);
    const rice = await makeProduct(s.owner.token, {
      categoryId: s.product.categoryId,
      name: 'Rice',
      price: 777,
    });
    await stockUp(s.owner.token, 'GUL', [
      { productId: s.product.id, qty: 10, unitCost: 100 },
      { productId: rice.id, qty: 10, unitCost: 100 },
    ]);
    const res = await sell(
      s.managerGul.token,
      'GUL',
      [
        { productId: s.product.id, qty: 7, discount: { type: 'percent', bps: 300 } },
        { productId: rice.id, qty: 5 },
      ],
      { discount: { type: 'amount', amount: 1234 } },
    );
    expect(res.status).toBe(201);
    const sale = res.body.sale as SaleDto;
    const [a, b] = sale.items as [SaleDto['items'][0], SaleDto['items'][0]];

    const steps = [
      [{ saleLineId: a.id, qty: 2, restock: true }],
      [
        { saleLineId: a.id, qty: 4, restock: false },
        { saleLineId: b.id, qty: 1, restock: true },
      ],
      [
        { saleLineId: a.id, qty: 1, restock: true },
        { saleLineId: b.id, qty: 4, restock: true },
      ],
    ];
    const returns: ReturnDto[] = [];
    for (const lines of steps) {
      const r = await as(s.managerGul.token)
        .post('/api/b/GUL/returns')
        .send({ clientReturnId: randomUUID(), saleId: sale.id, reason: 'wrong_item', lines });
      expect(r.status).toBe(201);
      returns.push(r.body.return);
      expect((await getSale(s, sale.id)).returnStatus).toBe(returns.length < 3 ? 'partial' : 'full');
    }
    const total = (k: 'net' | 'tax' | 'total') => returns.reduce((x, r) => x + r.totals[k], 0);
    expect({ net: total('net'), tax: total('tax'), total: total('total') }).toEqual({
      net: sale.totals.net,
      tax: sale.totals.tax,
      total: sale.totals.total,
    });
    expect(returns.reduce((x, r) => x + r.refund.amount, 0)).toBe(sale.totals.total);
  });
});

describe('returns: never more than sold (FR-RET-03)', () => {
  it(
    'two parallel returns of 2 against a line of 3 → exactly one wins (AC-RET-01)',
    { repeats },
    async () => {
      const { s, sale, line } = await soldThree();
      const [a, b] = await Promise.all([ret(s, sale.id, line.id, 2), ret(s, sale.id, line.id, 2)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect([a, b].find((x) => x.status === 409)!.body.error.code).toBe('RETURN_EXCEEDS_SOLD');
      expect((await getSale(s, sale.id)).items[0]!.returnedQty).toBe(2);
      expect(await gulQty(s)).toBe(9); // 7 + 2, once
    },
  );

  it('a single return above what is left → 409 with the remaining count; nothing changes', async () => {
    const { s, sale, line } = await soldThree();
    expect((await ret(s, sale.id, line.id, 2)).status).toBe(201);
    const over = await ret(s, sale.id, line.id, 2);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('RETURN_EXCEEDS_SOLD');
    expect(over.body.error.message).toMatch(/Only 1 /);
    expect(await gulQty(s)).toBe(9);
    expect(await SaleReturn.countDocuments({ branchId: s.gul._id })).toBe(1);
  });

  it('a multi-line return is all or nothing: one bad line rolls back the good one', async () => {
    const s = await shopWithStock(0);
    const rice = await makeProduct(s.owner.token, {
      categoryId: s.product.categoryId,
      name: 'Rice',
      price: 500,
    });
    await stockUp(s.owner.token, 'GUL', [
      { productId: s.product.id, qty: 5, unitCost: 100 },
      { productId: rice.id, qty: 5, unitCost: 100 },
    ]);
    const sale = (
      await sell(s.managerGul.token, 'GUL', [
        { productId: s.product.id, qty: 2 },
        { productId: rice.id, qty: 1 },
      ])
    ).body.sale as SaleDto;
    const res = await as(s.managerGul.token)
      .post('/api/b/GUL/returns')
      .send({
        clientReturnId: randomUUID(),
        saleId: sale.id,
        reason: 'changed_mind',
        lines: [
          { saleLineId: sale.items[0]!.id, qty: 1, restock: true },
          { saleLineId: sale.items[1]!.id, qty: 2, restock: true }, // only 1 sold
        ],
      });
    expect(res.status).toBe(409);
    const after = await getSale(s, sale.id);
    expect(after.items.map((i) => i.returnedQty)).toEqual([0, 0]);
    expect(after.returnStatus).toBe('none');
    expect(await StockMovement.countDocuments({ branchId: s.gul._id, type: 'return' })).toBe(0);
  });
});

describe('returns: restock vs write-off (FR-RET-06/07)', () => {
  it('restock adds stock and one movement; write-off changes nothing and records the loss (AC-RET-03)', async () => {
    const { s, sale, line } = await soldThree(); // stock 10 − 3 = 7
    const r = await ret(s, sale.id, line.id, 1, true);
    expect(await gulQty(s)).toBe(8);
    const moves = await StockMovement.find({ branchId: s.gul._id, type: 'return' }).lean();
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ qtyChange: 1, unitCost: 600, refType: 'return', refNo: 'GUL-R-000001' });
    expect(r.body.return.totals).toMatchObject({ costRestocked: 600, writeOff: 0 });

    const w = await ret(s, sale.id, line.id, 1, false);
    expect(await gulQty(s)).toBe(8); // unchanged
    expect(w.body.return.totals.writeOff).toBe(600); // manager sees cost
    expect(w.body.return.items[0]).toMatchObject({ restock: false, writeOffCost: 600 });
    expect(await StockMovement.countDocuments({ branchId: s.gul._id, type: 'return' })).toBe(1);
  });

  it('restocking re-blends the average at the ORIGINAL cost', async () => {
    const { s, sale, line } = await soldThree(); // 7 @ 600
    await stockUp(s.owner.token, 'GUL', [{ productId: s.product.id, qty: 3, unitCost: 700 }]); // 10 @ 630
    expect((await Inventory.findOne({ branchId: s.gul._id }).lean())!.avgCost).toBe(630);
    await ret(s, sale.id, line.id, 2, true); // (10 × 630 + 2 × 600) / 12 = 625
    const inv = (await Inventory.findOne({ branchId: s.gul._id }).lean())!;
    expect(inv).toMatchObject({ quantity: 12, avgCost: 625 });
  });
});

describe('returns: rules', () => {
  it('the same clientReturnId twice → one return', async () => {
    const { s, sale, line } = await soldThree();
    const body = {
      clientReturnId: randomUUID(),
      saleId: sale.id,
      reason: 'damaged',
      lines: [{ saleLineId: line.id, qty: 1, restock: false }],
    };
    const send = () => as(s.managerGul.token).post('/api/b/GUL/returns').send(body);
    const [a, b] = await Promise.all([send(), send()]);
    expect(new Set([a.body.return.returnNo, b.body.return.returnNo]).size).toBe(1);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await SaleReturn.countDocuments({ branchId: s.gul._id })).toBe(1);
    expect((await getSale(s, sale.id)).items[0]!.returnedQty).toBe(1);

    const later = await send(); // the network-drop retry
    expect(later.status).toBe(200);
    expect(later.body.replayed).toBe(true);
  });

  it('the window counts calendar days in the shop timezone: 30 days is fine, 31 is not', async () => {
    const { s, sale, line } = await soldThree();
    const today = toBusinessDate(new Date(), 'Asia/Dhaka');
    await Sale.collection.updateOne(
      { _id: new Types.ObjectId(sale.id) },
      {
        $set: { businessDate: addDaysToDate(today, -31) },
      },
    );
    const late = await ret(s, sale.id, line.id, 1);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('RETURN_WINDOW_EXPIRED');

    await Sale.collection.updateOne(
      { _id: new Types.ObjectId(sale.id) },
      {
        $set: { businessDate: addDaysToDate(today, -30) },
      },
    );
    expect((await ret(s, sale.id, line.id, 1)).status).toBe(201);
  });

  it("reason 'other' needs a note", async () => {
    const { s, sale, line } = await soldThree();
    const send = (note?: string) =>
      as(s.managerGul.token)
        .post('/api/b/GUL/returns')
        .send({
          clientReturnId: randomUUID(),
          saleId: sale.id,
          reason: 'other',
          note,
          lines: [{ saleLineId: line.id, qty: 1, restock: true }],
        });
    const bare = await send();
    expect(bare.status).toBe(400);
    expect(bare.body.error.code).toBe('VALIDATION_ERROR');
    expect((await send('   ')).status).toBe(400); // trimmed to empty
    expect((await send('Gift, duplicate')).status).toBe(201);
  });

  it('a line from another sale → 400 INVALID_LINE; the same line twice → 400 DUPLICATE_LINE', async () => {
    const { s, sale, line } = await soldThree();
    const other = (await sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 1 }])).body
      .sale as SaleDto;
    const wrong = await ret(s, sale.id, other.items[0]!.id, 1);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_LINE');

    const dup = await as(s.managerGul.token)
      .post('/api/b/GUL/returns')
      .send({
        clientReturnId: randomUUID(),
        saleId: sale.id,
        reason: 'changed_mind',
        lines: [
          { saleLineId: line.id, qty: 1, restock: true },
          { saleLineId: line.id, qty: 1, restock: false },
        ],
      });
    expect(dup.status).toBe(400);
    expect(dup.body.error.code).toBe('DUPLICATE_LINE');
  });

  it('numbers are per branch and gapless: a failed return does not consume one', async () => {
    const { s, sale, line } = await soldThree();
    expect((await ret(s, sale.id, line.id, 2)).body.return.returnNo).toBe('GUL-R-000001');
    expect((await ret(s, sale.id, line.id, 2)).status).toBe(409); // took a number inside, rolled back
    expect((await ret(s, sale.id, line.id, 1)).body.return.returnNo).toBe('GUL-R-000002');
  });

  it("the refund method defaults to the sale's first payment; it can be chosen", async () => {
    const { s, sale, line } = await soldThree({ payments: [{ method: 'card', amount: 2999 }] });
    expect((await ret(s, sale.id, line.id, 1)).body.return.refund).toEqual({ method: 'card', amount: 1000 });
    const cash = await as(s.managerGul.token)
      .post('/api/b/GUL/returns')
      .send({
        clientReturnId: randomUUID(),
        saleId: sale.id,
        reason: 'changed_mind',
        refundMethod: 'cash',
        lines: [{ saleLineId: line.id, qty: 1, restock: true }],
      });
    expect(cash.body.return.refund).toEqual({ method: 'cash', amount: 999 });
  });

  it('a return counts on the day it happens, not on the sale day', async () => {
    const { s, sale, line } = await soldThree();
    const today = toBusinessDate(new Date(), 'Asia/Dhaka');
    await Sale.collection.updateOne(
      { _id: new Types.ObjectId(sale.id) },
      {
        $set: { businessDate: addDaysToDate(today, -5) },
      },
    );
    expect((await ret(s, sale.id, line.id, 1)).body.return.businessDate).toBe(today);
  });
});

describe('returns: reading them back', () => {
  it('detail, list (newest first, invoice filter) and the sale page links', async () => {
    const { s, sale, line } = await soldThree();
    const r1 = (await ret(s, sale.id, line.id, 1)).body.return as ReturnDto;
    const r2 = (await ret(s, sale.id, line.id, 1, false)).body.return as ReturnDto;

    const detail = await as(s.managerGul.token).get(`/api/b/GUL/returns/${r1.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.return).toEqual(r1);

    const list = await as(s.managerGul.token).get('/api/b/GUL/returns');
    expect(list.body.items.map((r: { returnNo: string }) => r.returnNo)).toEqual([r2.returnNo, r1.returnNo]);
    expect(list.body.items[0]).toMatchObject({ invoiceNo: sale.invoiceNo, itemCount: 1, saleId: sale.id });
    const none = await as(s.managerGul.token).get('/api/b/GUL/returns?invoiceNo=GUL-999999');
    expect(none.body.items).toEqual([]);
    const byInvoice = await as(s.managerGul.token).get(
      `/api/b/GUL/returns?invoiceNo=${sale.invoiceNo.toLowerCase()}`,
    );
    expect(byInvoice.body.items).toHaveLength(2);

    const withLinks = await getSale(s, sale.id);
    expect(withLinks.returns!.map((r) => r.returnNo)).toEqual([r1.returnNo, r2.returnNo]);
    expect(withLinks.returns![0]!.total).toBe(1000);
    // A cashier may see their own sale, but not the returns (no return:view)
    const own = (await as(s.cashierGul.token).get(`/api/b/GUL/sales/${sale.id}`)).body.sale as SaleDto;
    expect(own.returnStatus).toBe('partial');
    expect(own.returns).toBeUndefined();
  });

  it('a cashier may not take returns (403); the Owner may', async () => {
    const { s, sale, line } = await soldThree();
    const send = (token: string) =>
      as(token)
        .post('/api/b/GUL/returns')
        .send({
          clientReturnId: randomUUID(),
          saleId: sale.id,
          reason: 'changed_mind',
          lines: [{ saleLineId: line.id, qty: 1, restock: true }],
        });
    expect((await send(s.cashierGul.token)).status).toBe(403);
    expect((await as(s.cashierGul.token).get('/api/b/GUL/returns')).status).toBe(403);
    expect((await send(s.owner.token)).status).toBe(201);
  });

  it("another branch's sale or return is a 404, even for the Owner", async () => {
    const { s, sale, line } = await soldThree();
    const r = (await ret(s, sale.id, line.id, 1)).body.return as ReturnDto;
    expect((await as(s.owner.token).get(`/api/b/DHN/returns/${r.id}`)).status).toBe(404);
    const viaDhn = await as(s.owner.token)
      .post('/api/b/DHN/returns')
      .send({
        clientReturnId: randomUUID(),
        saleId: sale.id,
        reason: 'changed_mind',
        lines: [{ saleLineId: line.id, qty: 1, restock: true }],
      });
    expect(viaDhn.status).toBe(404);
    expect((await as(s.managerGul.token).get(`/api/b/DHN/returns/${r.id}`)).status).toBe(404);
  });
});
