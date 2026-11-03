import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addDaysToDate, toBusinessDate, type PODto, type PORowDto } from '@shopstock/shared';
import { Inventory, StockMovement } from '../src/db/models';
import { as } from './helpers/auth';
import { makeProduct } from './factories/catalog';
import { draftPO, makeSupplier, orderedPO, receive } from './factories/purchasing';
import { shopWithStock } from './factories/sales';
import type { Shop } from './factories/shop';
import { stockUp } from './factories/stock';

const repeats = Number(process.env.REPEATS ?? 5);
const today = () => toBusinessDate(new Date(), 'Asia/Dhaka');
const po = (code = 'GUL') => `/api/b/${code}/purchase-orders`;

/** A manager at GUL, a supplier and an ORDERED PO of `qty` of the shop's product. */
async function ordered(qty = 10, unitCost = 100, stock = 0) {
  const s = await shopWithStock(stock, { cost: 5000 });
  const sup = await makeSupplier(s.owner.token);
  const p = await orderedPO(s.managerGul.token, 'GUL', sup.id, [
    { productId: s.product.id, orderedQty: qty, unitCost },
  ]);
  return { s, sup, po: p };
}
const gulInv = async (s: Shop) => (await Inventory.findOne({ branchId: s.gul._id }).lean())!;

describe('purchase orders: receiving (FR-PO-05)', () => {
  it('WAC: 10 @ 50.00 on hand + receive 10 @ 80.00 → 20 @ 65.00 (AC-PO-03)', async () => {
    const s = await shopWithStock(10, { cost: 5000 });
    const sup = await makeSupplier(s.owner.token);
    const p = await orderedPO(s.managerGul.token, 'GUL', sup.id, [
      { productId: s.product.id, orderedQty: 10, unitCost: 8000 },
    ]);
    const r = await receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 10 }]);
    expect(r.status).toBe(200);
    expect(r.body.replayed).toBe(false);
    expect(r.body.purchaseOrder.status).toBe('received');
    expect(r.body.purchaseOrder.completedAt).not.toBeNull();
    expect(await Inventory.findOne({ branchId: s.gul._id }).lean()).toMatchObject({
      quantity: 20,
      avgCost: 6500,
    });
    const m = await StockMovement.findOne({ branchId: s.gul._id, type: 'purchase_receipt' }).lean();
    expect(m).toMatchObject({ qtyChange: 10, unitCost: 8000, refType: 'purchaseOrder', refNo: p.poNumber });
  });

  it('partial receipts, then complete: two receipts, lines and totals derived', async () => {
    const { s, po: p } = await ordered(10, 39000);
    const first = await receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 7 }]);
    expect(first.body.purchaseOrder.status).toBe('partially_received');
    expect(first.body.purchaseOrder.items[0]).toMatchObject({ orderedQty: 10, receivedQty: 7, remaining: 3 });
    expect(first.body.purchaseOrder.completedAt).toBeNull();

    const done = await receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 3 }]);
    const body = done.body.purchaseOrder as PODto;
    expect(body.status).toBe('received');
    expect(body.receipts).toHaveLength(2);
    expect(body.receipts[0]).toMatchObject({ receivedByName: expect.stringMatching(/manager/) });
    expect(body.totals).toEqual({ orderedValue: 390_000, receivedValue: 390_000 });
    expect((await gulInv(s)).quantity).toBe(10);
    expect(await StockMovement.countDocuments({ branchId: s.gul._id, type: 'purchase_receipt' })).toBe(2);
  });

  it('a receipt of several lines writes one movement per line', async () => {
    const s = await shopWithStock(0);
    const rice = await makeProduct(s.owner.token, { categoryId: s.product.categoryId, name: 'Rice' });
    const sup = await makeSupplier(s.owner.token);
    const p = await orderedPO(s.managerGul.token, 'GUL', sup.id, [
      { productId: s.product.id, orderedQty: 5, unitCost: 100 },
      { productId: rice.id, orderedQty: 5, unitCost: 200 },
    ]);
    const r = await receive(s.managerGul.token, 'GUL', p.id, [
      { productId: s.product.id, qty: 5 },
      { productId: rice.id, qty: 2 },
    ]);
    expect(r.body.purchaseOrder.status).toBe('partially_received');
    const moves = await StockMovement.find({ branchId: s.gul._id, type: 'purchase_receipt' }).lean();
    expect(moves.map((m) => [m.qtyChange, m.unitCost, m.refNo]).sort()).toEqual(
      [
        [5, 100, p.poNumber],
        [2, 200, p.poNumber],
      ].sort(),
    );
  });

  it('two managers receive 6 each of 10 → exactly one succeeds (AC-PO-01)', { repeats }, async () => {
    const { s, po: p } = await ordered(10);
    const [a, b] = await Promise.all([
      receive(s.owner.token, 'GUL', p.id, [{ productId: s.product.id, qty: 6 }]),
      receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 6 }]),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((x) => x.status === 409)!.body.error.code).toBe('RECEIVE_EXCEEDS_ORDERED');
    expect((await gulInv(s)).quantity).toBe(6);
    const after = (await as(s.owner.token).get(`${po()}/${p.id}`)).body.purchaseOrder as PODto;
    expect(after.receipts).toHaveLength(1); // the loser's receipt was rolled back with its line update
    expect(after.items[0]!.receivedQty).toBe(6);
  });

  it('the same receipt twice is applied once (AC-PO-02)', { repeats }, async () => {
    const { s, po: p } = await ordered(10);
    const id = randomUUID();
    const send = () => receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 4 }], id);
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.replayed, b.body.replayed].sort()).toEqual([false, true]);
    expect((await gulInv(s)).quantity).toBe(4);

    const later = await send(); // a retry after the network dropped
    expect(later.body.replayed).toBe(true);
    expect(later.body.purchaseOrder.receipts).toHaveLength(1);
    expect((await gulInv(s)).quantity).toBe(4);
  });

  it('a unit cost override on a receipt line is used for the movement, the average and receivedValue', async () => {
    const { s, po: p } = await ordered(10, 8000, 10); // 10 on hand @ 5000
    const r = await receive(s.managerGul.token, 'GUL', p.id, [
      { productId: s.product.id, qty: 10, unitCost: 9000 },
    ]);
    expect(r.body.purchaseOrder.totals).toEqual({ orderedValue: 80_000, receivedValue: 90_000 });
    expect(r.body.purchaseOrder.receipts[0].lines[0].unitCost).toBe(9000);
    expect(await gulInv(s)).toMatchObject({ quantity: 20, avgCost: 7000 });
    expect(
      await StockMovement.findOne({ branchId: s.gul._id, type: 'purchase_receipt' }).lean(),
    ).toMatchObject({
      unitCost: 9000,
    });
  });

  it('receiving more than remaining → 409 RECEIVE_EXCEEDS_ORDERED; nothing changes', async () => {
    const { s, po: p } = await ordered(10);
    await receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 8 }]);
    const over = await receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 3 }]);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('RECEIVE_EXCEEDS_ORDERED');
    expect(over.body.error.message).toMatch(/Only 2 /);
    expect((await gulInv(s)).quantity).toBe(8);
  });

  it('a product not on the PO → 400 INVALID_LINE', async () => {
    const { s, po: p } = await ordered(10);
    const other = await makeProduct(s.owner.token, { categoryId: s.product.categoryId });
    const r = await receive(s.managerGul.token, 'GUL', p.id, [{ productId: other.id, qty: 1 }]);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_LINE');
  });

  it('the 21st receipt → 409 INVALID_STATE (at most 20 deliveries per PO)', async () => {
    const { s, po: p } = await ordered(25);
    for (let i = 0; i < 20; i++) {
      expect(
        (await receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 1 }])).status,
      ).toBe(200);
    }
    const r21 = await receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 1 }]);
    expect(r21.status).toBe(409);
    expect(r21.body.error.code).toBe('INVALID_STATE');
    expect(r21.body.error.message).toMatch(/at most 20/);
    expect((await gulInv(s)).quantity).toBe(20);
  });
});

describe('purchase orders: the state machine (FR-PO-03/04/07/08/09)', () => {
  it('receive on a draft → 409 INVALID_STATE', async () => {
    const s = await shopWithStock(0);
    const sup = await makeSupplier(s.owner.token);
    const d = await draftPO(s.managerGul.token, 'GUL', sup.id, [
      { productId: s.product.id, orderedQty: 5, unitCost: 1 },
    ]);
    const r = await receive(s.managerGul.token, 'GUL', d.id, [{ productId: s.product.id, qty: 1 }]);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INVALID_STATE');
  });

  it('a draft can be edited (and a PATCH keeps what it leaves out); an ordered PO cannot', async () => {
    const s = await shopWithStock(0);
    const sup = await makeSupplier(s.owner.token);
    const sup2 = await makeSupplier(s.owner.token);
    const d = (
      await as(s.managerGul.token)
        .post(po())
        .send({
          supplierId: sup.id,
          lines: [{ productId: s.product.id, orderedQty: 5, unitCost: 100 }],
          notes: 'Call before delivery',
          expectedDate: addDaysToDate(today(), 3),
        })
    ).body.purchaseOrder as PODto;

    const edited = await as(s.managerGul.token).patch(`${po()}/${d.id}`).send({ supplierId: sup2.id });
    expect(edited.status).toBe(200);
    expect(edited.body.purchaseOrder).toMatchObject({
      supplierName: sup2.name,
      notes: 'Call before delivery', // not blanked by the PATCH
      expectedDate: addDaysToDate(today(), 3),
    });
    const relined = await as(s.managerGul.token)
      .patch(`${po()}/${d.id}`)
      .send({ lines: [{ productId: s.product.id, orderedQty: 8, unitCost: 120 }], expectedDate: null });
    expect(relined.body.purchaseOrder.items[0]).toMatchObject({
      orderedQty: 8,
      unitCost: 120,
      receivedQty: 0,
    });
    expect(relined.body.purchaseOrder.expectedDate).toBeNull();

    await as(s.managerGul.token).post(`${po()}/${d.id}/order`);
    const late = await as(s.managerGul.token).patch(`${po()}/${d.id}`).send({ notes: 'x' });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('INVALID_STATE');
    expect(late.body.error.message).toBe('Not allowed while ordered.');
  });

  it('a draft can be deleted; an ordered PO cannot; a missing one is 404', async () => {
    const s = await shopWithStock(0);
    const sup = await makeSupplier(s.owner.token);
    const line = [{ productId: s.product.id, orderedQty: 5, unitCost: 1 }];
    const d = await draftPO(s.managerGul.token, 'GUL', sup.id, line);
    expect((await as(s.managerGul.token).delete(`${po()}/${d.id}`)).status).toBe(204);
    expect((await as(s.managerGul.token).get(`${po()}/${d.id}`)).status).toBe(404);
    expect((await as(s.managerGul.token).delete(`${po()}/${d.id}`)).status).toBe(404);

    const o = await orderedPO(s.managerGul.token, 'GUL', sup.id, line);
    expect((await as(s.managerGul.token).delete(`${po()}/${o.id}`)).status).toBe(409);
  });

  it('order: only from draft; ordering twice → 409', async () => {
    const { s, po: p } = await ordered(5);
    expect(p.status).toBe('ordered');
    expect(p.orderedAt).not.toBeNull();
    const again = await as(s.managerGul.token).post(`${po()}/${p.id}/order`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
  });

  it('cancel: a draft or an ordered PO with nothing received; never after a receipt', async () => {
    const { s, sup, po: p } = await ordered(10);
    const d = await draftPO(s.managerGul.token, 'GUL', sup.id, [
      { productId: s.product.id, orderedQty: 1, unitCost: 1 },
    ]);
    const c1 = await as(s.managerGul.token).post(`${po()}/${d.id}/cancel`);
    expect(c1.body.purchaseOrder).toMatchObject({ status: 'cancelled' });
    expect(c1.body.purchaseOrder.cancelledAt).not.toBeNull();

    await receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 1 }]);
    const c2 = await as(s.managerGul.token).post(`${po()}/${p.id}/cancel`);
    expect(c2.status).toBe(409);
    expect(c2.body.error.code).toBe('INVALID_STATE');

    const fresh = await orderedPO(s.managerGul.token, 'GUL', sup.id, [
      { productId: s.product.id, orderedQty: 1, unitCost: 1 },
    ]);
    expect((await as(s.managerGul.token).post(`${po()}/${fresh.id}/cancel`)).body.purchaseOrder.status).toBe(
      'cancelled',
    );
    const r = await receive(s.managerGul.token, 'GUL', fresh.id, [{ productId: s.product.id, qty: 1 }]);
    expect(r.status).toBe(409); // a cancelled PO can't be received
  });

  it('close: a partially received PO closes, then cannot be received; an ordered one cannot close', async () => {
    const { s, po: p } = await ordered(10);
    expect((await as(s.managerGul.token).post(`${po()}/${p.id}/close`)).status).toBe(409); // ordered
    await receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 4 }]);
    const closed = await as(s.managerGul.token).post(`${po()}/${p.id}/close`);
    expect(closed.body.purchaseOrder).toMatchObject({ status: 'closed' });
    expect(closed.body.purchaseOrder.closedAt).not.toBeNull();
    const r = await receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 1 }]);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INVALID_STATE');
    expect((await gulInv(s)).quantity).toBe(4);
  });

  it(
    'order and delete of one draft at the same moment → exactly one wins (compare-and-set)',
    { repeats },
    async () => {
      const s = await shopWithStock(0);
      const sup = await makeSupplier(s.owner.token);
      const d = await draftPO(s.managerGul.token, 'GUL', sup.id, [
        { productId: s.product.id, orderedQty: 1, unitCost: 1 },
      ]);
      const [order, del] = await Promise.all([
        as(s.managerGul.token).post(`${po()}/${d.id}/order`),
        as(s.owner.token).delete(`${po()}/${d.id}`),
      ]);
      const after = await as(s.owner.token).get(`${po()}/${d.id}`);
      if (order.status === 200) {
        expect(del.status).toBe(409); // it was no longer a draft
        expect(after.body.purchaseOrder.status).toBe('ordered');
      } else {
        expect([order.status, del.status]).toEqual([404, 204]); // deleted first: nothing left to order
        expect(after.status).toBe(404);
      }
    },
  );

  it('transitions on a missing PO → 404', async () => {
    const s = await shopWithStock(0);
    for (const action of ['order', 'cancel', 'close']) {
      expect((await as(s.managerGul.token).post(`${po()}/0123456789abcdef01234567/${action}`)).status).toBe(
        404,
      );
    }
  });
});

describe('purchase orders: creating (FR-PO-01/02)', () => {
  it('the first PO of the year is PO-<year>-0001, then 0002; snapshots sku, name, supplier', async () => {
    const s = await shopWithStock(0);
    const sup = await makeSupplier(s.owner.token, 'Meghna Distributors');
    const line = [{ productId: s.product.id, orderedQty: 5, unitCost: 100 }];
    const a = await draftPO(s.managerGul.token, 'GUL', sup.id, line);
    const b = await draftPO(s.managerDhn.token, 'DHN', sup.id, line); // the counter is shop-wide
    const year = today().slice(0, 4);
    expect([a.poNumber, b.poNumber]).toEqual([`PO-${year}-0001`, `PO-${year}-0002`]);
    expect(a).toMatchObject({ status: 'draft', supplierName: 'Meghna Distributors' });
    expect(a.items[0]).toMatchObject({ sku: s.product.sku, name: 'Soybean Oil 1L', remaining: 5 });
    expect(a.totals).toEqual({ orderedValue: 500, receivedValue: 0 });
  });

  it('an inactive supplier → 400 INVALID_SUPPLIER', async () => {
    const s = await shopWithStock(0);
    const sup = await makeSupplier(s.owner.token);
    await as(s.owner.token).patch(`/api/suppliers/${sup.id}`).send({ isActive: false });
    const r = await as(s.managerGul.token)
      .post(po())
      .send({ supplierId: sup.id, lines: [{ productId: s.product.id, orderedQty: 1, unitCost: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_SUPPLIER');
  });

  it('an archived product → 400 PRODUCT_INACTIVE; the same product twice → 400', async () => {
    const s = await shopWithStock(0);
    const sup = await makeSupplier(s.owner.token);
    await as(s.owner.token).patch(`/api/products/${s.product.id}`).send({ isActive: false });
    const r = await as(s.managerGul.token)
      .post(po())
      .send({ supplierId: sup.id, lines: [{ productId: s.product.id, orderedQty: 1, unitCost: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('PRODUCT_INACTIVE');
    expect(r.body.error.details).toEqual([{ productId: s.product.id }]);

    const dup = await as(s.managerGul.token)
      .post(po())
      .send({
        supplierId: sup.id,
        lines: [
          { productId: s.product.id, orderedQty: 1, unitCost: 1 },
          { productId: s.product.id, orderedQty: 2, unitCost: 1 },
        ],
      });
    expect(dup.status).toBe(400);
  });

  it('an expected date in the past (shop timezone) → 400; today is fine', async () => {
    const s = await shopWithStock(0);
    const sup = await makeSupplier(s.owner.token);
    const send = (expectedDate: string) =>
      as(s.managerGul.token)
        .post(po())
        .send({
          supplierId: sup.id,
          lines: [{ productId: s.product.id, orderedQty: 1, unitCost: 1 }],
          expectedDate,
        });
    const past = await send(addDaysToDate(today(), -1));
    expect(past.status).toBe(400);
    expect(past.body.error.code).toBe('EXPECTED_DATE_PAST');
    expect((await send(today())).status).toBe(201);
  });

  it('an archived product already on an ordered PO can still be received', async () => {
    const { s, po: p } = await ordered(5);
    await as(s.owner.token).patch(`/api/products/${s.product.id}`).send({ isActive: false });
    expect(
      (await receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 5 }])).status,
    ).toBe(200);
  });
});

describe('purchase orders: reading', () => {
  it('list: newest first, filtered by status and supplier', async () => {
    const s = await shopWithStock(0);
    const [supA, supB] = [await makeSupplier(s.owner.token), await makeSupplier(s.owner.token)];
    const line = [{ productId: s.product.id, orderedQty: 5, unitCost: 100 }];
    const d1 = await draftPO(s.managerGul.token, 'GUL', supA.id, line);
    const o1 = await orderedPO(s.managerGul.token, 'GUL', supB.id, line);
    const d2 = await draftPO(s.managerGul.token, 'GUL', supB.id, line);
    await draftPO(s.managerDhn.token, 'DHN', supA.id, line); // another branch: never listed at GUL

    const nos = async (q = '') =>
      ((await as(s.managerGul.token).get(`${po()}${q}`)).body.items as PORowDto[]).map((r) => r.poNumber);
    expect(await nos()).toEqual([d2.poNumber, o1.poNumber, d1.poNumber]);
    expect(await nos('?status=draft')).toEqual([d2.poNumber, d1.poNumber]);
    expect(await nos(`?supplierId=${supB.id}`)).toEqual([d2.poNumber, o1.poNumber]);
    const row = (await as(s.managerGul.token).get(po())).body.items[0] as PORowDto;
    expect(row).toMatchObject({ lineCount: 1, orderedValue: 500, status: 'draft', supplierName: supB.name });
  });

  it("another branch's PO is a 404 under this branch's code, even to receive it", async () => {
    const s = await shopWithStock(0);
    const sup = await makeSupplier(s.owner.token);
    const dhnPo = await orderedPO(s.owner.token, 'DHN', sup.id, [
      { productId: s.product.id, orderedQty: 5, unitCost: 1 },
    ]);
    expect((await as(s.managerGul.token).get(`${po()}/${dhnPo.id}`)).status).toBe(404);
    expect(
      (await receive(s.managerGul.token, 'GUL', dhnPo.id, [{ productId: s.product.id, qty: 1 }])).status,
    ).toBe(404);
    expect(
      (await receive(s.owner.token, 'GUL', dhnPo.id, [{ productId: s.product.id, qty: 1 }])).status,
    ).toBe(404);
    expect((await as(s.managerGul.token).post(`${po()}/${dhnPo.id}/cancel`)).status).toBe(404);
  });

  it('suggestions: a product at 3 with reorder level 10 → suggestedQty 17, with the last purchase cost', async () => {
    const s = await shopWithStock(3, { cost: 5000 });
    await as(s.managerGul.token).patch(`/api/b/GUL/inventory/${s.product.id}`).send({ reorderLevel: 10 });
    const fine = await makeProduct(s.owner.token, { categoryId: s.product.categoryId, name: 'Plenty' });
    await stockUp(s.owner.token, 'GUL', [{ productId: fine.id, qty: 50, unitCost: 10 }]);

    const before = await as(s.managerGul.token).get(`${po()}/suggestions`);
    expect(before.status).toBe(200);
    expect(before.body.suggestions).toEqual([
      expect.objectContaining({
        productId: s.product.id,
        quantity: 3,
        reorderLevel: 10,
        status: 'low',
        suggestedQty: 17,
        lastCost: null,
      }),
    ]);

    const sup = await makeSupplier(s.owner.token);
    const p = await orderedPO(s.managerGul.token, 'GUL', sup.id, [
      { productId: s.product.id, orderedQty: 5, unitCost: 4200 },
    ]);
    await receive(s.managerGul.token, 'GUL', p.id, [{ productId: s.product.id, qty: 2 }]); // 5 of 10: still low
    const after = await as(s.managerGul.token).get(`${po()}/suggestions`);
    expect(after.body.suggestions[0]).toMatchObject({ quantity: 5, suggestedQty: 15, lastCost: 4200 });
    expect((await as(s.cashierGul.token).get(`${po()}/suggestions`)).status).toBe(403);
  });
});
