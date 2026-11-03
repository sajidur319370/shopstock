import { describe, expect, it } from 'vitest';
import { toBusinessDate, type TransferDto, type TransferRowDto } from '@shopstock/shared';
import { Inventory, StockMovement, Transfer } from '../src/db/models';
import { invalidateCache } from '../src/lib/cache';
import { as } from './helpers/auth';
import { makeCategory, makeProduct } from './factories/catalog';
import { sell, shopWithStock } from './factories/sales';
import type { Shop } from './factories/shop';
import { stockUp } from './factories/stock';
import { cancelTransfer, dispatch, makeTransfer, receiveTransfer } from './factories/transfers';

const repeats = Number(process.env.REPEATS ?? 5);
const inv = async (branchId: Shop['gul']['_id'], productId?: string) =>
  (await Inventory.findOne({ branchId, ...(productId && { productId }) }).lean())!;
const year = () => toBusinessDate(new Date(), 'Asia/Dhaka').slice(0, 4);

describe('transfers: dispatch and receive (FR-TRF-02..05)', () => {
  it('GUL → DHN: out at GUL average, in at that cost, DHN average re-blended', async () => {
    const s = await shopWithStock(10, { cost: 16000 }); // GUL 10 @ 160.00
    await stockUp(s.owner.token, 'DHN', [{ productId: s.product.id, qty: 2, unitCost: 19000 }]); // DHN 2 @ 190.00
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 4 }]);
    expect(t).toMatchObject({
      status: 'pending',
      transferNo: `TR-${year()}-0001`,
      direction: 'outgoing',
      fromCode: 'GUL',
      toCode: 'DHN',
      totals: { units: 4, value: null },
    });
    expect(t.items[0]!.unitCost).toBeNull();

    const d = await dispatch(s.managerGul.token, 'GUL', t.id);
    expect(d.status).toBe(200);
    expect(d.body.transfer).toMatchObject({
      status: 'in_transit',
      items: [{ qty: 4, unitCost: 16000 }],
      totals: { units: 4, value: 64000 },
    });
    expect(d.body.transfer.dispatchedByName).toMatch(/manager/);
    expect((await inv(s.gul._id)).quantity).toBe(6);

    const r = await receiveTransfer(s.managerDhn.token, 'DHN', t.id);
    expect(r.status).toBe(200);
    expect(r.body.transfer).toMatchObject({ status: 'received', direction: 'incoming' });
    // (2 × 19000 + 4 × 16000) / 6 = 102000 / 6 = 17000
    expect(await inv(s.dhn._id)).toMatchObject({ quantity: 6, avgCost: 17000 });
    const moves = await StockMovement.find({
      refType: 'transfer',
      branchId: { $in: [s.gul._id, s.dhn._id] },
    }).lean();
    expect(moves.map((m) => [m.type, m.qtyChange, m.unitCost, m.refNo]).sort()).toEqual(
      [
        ['transfer_in', 4, 16000, t.transferNo],
        ['transfer_out', -4, 16000, t.transferNo],
      ].sort(),
    );
  });

  it('a first arrival at DHN creates its row with the product reorder level', async () => {
    const s = await shopWithStock(10); // the factory product's reorder level is 5
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 4 }]);
    await dispatch(s.managerGul.token, 'GUL', t.id);
    await receiveTransfer(s.managerDhn.token, 'DHN', t.id);
    expect(await inv(s.dhn._id)).toMatchObject({ quantity: 4, reorderLevel: 5 });
  });

  it('dispatch with one short line changes nothing (AC-TRF-01)', async () => {
    const s = await shopWithStock(10);
    const cat = await makeCategory(s.owner.token);
    const rice = await makeProduct(s.owner.token, { categoryId: cat.id });
    await stockUp(s.owner.token, 'GUL', [{ productId: rice.id, qty: 2, unitCost: 100 }]);
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [
      { productId: s.product.id, qty: 5 },
      { productId: rice.id, qty: 3 },
    ]);

    const d = await dispatch(s.managerGul.token, 'GUL', t.id);
    expect(d.status).toBe(409);
    expect(d.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(d.body.error.details).toEqual([expect.objectContaining({ productId: rice.id, available: 2 })]);
    expect((await inv(s.gul._id, s.product.id)).quantity).toBe(10);
    expect((await as(s.managerGul.token).get(`/api/b/GUL/transfers/${t.id}`)).body.transfer.status).toBe(
      'pending',
    );
    expect(await StockMovement.countDocuments({ branchId: s.gul._id, refType: 'transfer' })).toBe(0);
  });

  it('two parallel receives → exactly one (AC-TRF-02)', { repeats }, async () => {
    const s = await shopWithStock(10);
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 4 }]);
    await dispatch(s.managerGul.token, 'GUL', t.id);
    const [a, b] = await Promise.all([
      receiveTransfer(s.managerDhn.token, 'DHN', t.id),
      receiveTransfer(s.owner.token, 'DHN', t.id),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((x) => x.status === 409)!.body.error.code).toBe('INVALID_STATE');
    expect((await inv(s.dhn._id)).quantity).toBe(4);
  });

  it('two parallel dispatches → one 200, one 409; stock out once', { repeats }, async () => {
    const s = await shopWithStock(10);
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 4 }]);
    const [a, b] = await Promise.all([
      dispatch(s.managerGul.token, 'GUL', t.id),
      dispatch(s.owner.token, 'GUL', t.id),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((x) => x.status === 409)!.body.error.code).toBe('INVALID_STATE');
    expect((await inv(s.gul._id)).quantity).toBe(6);
    expect(await StockMovement.countDocuments({ branchId: s.gul._id, type: 'transfer_out' })).toBe(1);
  });

  it('the source manager cannot receive (AC-TRF-03)', async () => {
    const s = await shopWithStock(10);
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 4 }]);
    await dispatch(s.managerGul.token, 'GUL', t.id);
    expect((await receiveTransfer(s.managerGul.token, 'DHN', t.id)).status).toBe(404); // resolveBranch
    expect((await receiveTransfer(s.managerGul.token, 'GUL', t.id)).status).toBe(404); // toBranchId filter
    expect((await receiveTransfer(s.owner.token, 'GUL', t.id)).status).toBe(404); // even the Owner, at the source
  });

  it('dispatch vs a sale for the last units → exactly one wins (E8)', { repeats }, async () => {
    const s = await shopWithStock(3);
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 3 }]);
    const [d, sale] = await Promise.all([
      dispatch(s.managerGul.token, 'GUL', t.id),
      sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 3 }]),
    ]);
    // dispatch answers 200, a sale 201: exactly one of them succeeded, the other got INSUFFICIENT_STOCK
    expect([d.status === 200, sale.status === 201].filter(Boolean)).toHaveLength(1);
    expect([d, sale].find((x) => x.status === 409)!.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await inv(s.gul._id)).quantity).toBe(0);
    if (d.status === 409) {
      const after = (await as(s.managerGul.token).get(`/api/b/GUL/transfers/${t.id}`)).body.transfer;
      expect(after.status).toBe('pending'); // the rolled-back CAS: still pending, can be cancelled
    }
  });
});

describe('transfers: create and cancel (FR-TRF-01/06)', () => {
  it('destination = source → 400 SAME_BRANCH; unknown or inactive → 400 INVALID_BRANCH', async () => {
    const s = await shopWithStock(10);
    const send = (toBranchCode: string) =>
      as(s.managerGul.token)
        .post('/api/b/GUL/transfers')
        .send({ toBranchCode, lines: [{ productId: s.product.id, qty: 1 }] });
    expect((await send('gul')).body.error.code).toBe('SAME_BRANCH');
    expect((await send('NOPE')).body.error.code).toBe('INVALID_BRANCH');
    await as(s.owner.token).patch(`/api/branches/${s.dhn._id}`).send({ isActive: false });
    invalidateCache();
    const r = await send('DHN');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_BRANCH');
  });

  it('a manager may send to a branch they do not manage', async () => {
    const s = await shopWithStock(10);
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 1 }]);
    expect(t.toCode).toBe('DHN');
    const dest = await as(s.managerGul.token).get('/api/b/GUL/transfers/destinations');
    expect(dest.body.branches).toEqual([{ code: 'DHN', name: 'Dhanmondi' }]);
  });

  it('dispatching to a branch deactivated after creation → 400 INVALID_BRANCH, nothing moves', async () => {
    const s = await shopWithStock(10);
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 1 }]);
    await as(s.owner.token).patch(`/api/branches/${s.dhn._id}`).send({ isActive: false });
    invalidateCache();
    const d = await dispatch(s.managerGul.token, 'GUL', t.id);
    expect(d.status).toBe(400);
    expect(d.body.error.code).toBe('INVALID_BRANCH');
    expect((await inv(s.gul._id)).quantity).toBe(10);
  });

  it('an archived product → 400 PRODUCT_INACTIVE', async () => {
    const s = await shopWithStock(10);
    await as(s.owner.token).patch(`/api/products/${s.product.id}`).send({ isActive: false });
    const r = await as(s.managerGul.token)
      .post('/api/b/GUL/transfers')
      .send({ toBranchCode: 'DHN', lines: [{ productId: s.product.id, qty: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('PRODUCT_INACTIVE');
  });

  it('cancel a pending transfer: cancelled, no movements; after dispatch → 409', async () => {
    const s = await shopWithStock(10);
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 2 }]);
    const c = await cancelTransfer(s.managerGul.token, 'GUL', t.id);
    expect(c.body.transfer).toMatchObject({ status: 'cancelled' });
    expect(c.body.transfer.cancelledAt).not.toBeNull();
    expect(c.body.transfer.cancelledByName).toMatch(/manager/);
    expect(await StockMovement.countDocuments({ branchId: s.gul._id, refType: 'transfer' })).toBe(0);
    expect((await dispatch(s.managerGul.token, 'GUL', t.id)).status).toBe(409); // cancelled can't leave

    const t2 = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 2 }]);
    await dispatch(s.managerGul.token, 'GUL', t2.id);
    const late = await cancelTransfer(s.managerGul.token, 'GUL', t2.id);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('INVALID_STATE');
  });

  it("cancel or dispatch from the destination's code → 404", async () => {
    const s = await shopWithStock(10);
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 2 }]);
    expect((await cancelTransfer(s.managerDhn.token, 'DHN', t.id)).status).toBe(404);
    expect((await dispatch(s.managerDhn.token, 'DHN', t.id)).status).toBe(404);
    expect((await cancelTransfer(s.owner.token, 'DHN', t.id)).status).toBe(404); // the Owner too: wrong side
    // ...but the destination can READ it
    const read = await as(s.managerDhn.token).get(`/api/b/DHN/transfers/${t.id}`);
    expect(read.body.transfer).toMatchObject({ direction: 'incoming', status: 'pending' });
  });
});

describe('transfers: reading', () => {
  it('direction=incoming at DHN lists GUL → DHN, not DHN → GUL', async () => {
    const s = await shopWithStock(10);
    await stockUp(s.owner.token, 'DHN', [{ productId: s.product.id, qty: 10, unitCost: 100 }]);
    const g2d = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 1 }]);
    const d2g = await makeTransfer(s.managerDhn.token, 'DHN', 'GUL', [{ productId: s.product.id, qty: 1 }]);
    const nos = async (q: string) =>
      ((await as(s.managerDhn.token).get(`/api/b/DHN/transfers${q}`)).body.items as TransferRowDto[]).map(
        (r) => [r.transferNo, r.direction],
      );
    expect(await nos('?direction=incoming')).toEqual([[g2d.transferNo, 'incoming']]);
    expect(await nos('?direction=outgoing')).toEqual([[d2g.transferNo, 'outgoing']]);
    expect(await nos('')).toEqual([
      [d2g.transferNo, 'outgoing'],
      [g2d.transferNo, 'incoming'],
    ]);
    expect(await nos('?status=cancelled')).toEqual([]);
  });

  it('list paging: 55 transfers → 50 + cursor, then 5; no duplicates', async () => {
    const s = await shopWithStock(10);
    // Inserted directly (55 API round trips add nothing): distinct createdAt, two with the same instant.
    const base = Date.now();
    await Transfer.insertMany(
      Array.from({ length: 55 }, (_, i) => ({
        transferNo: `TR-T-${String(i).padStart(4, '0')}`,
        fromBranchId: i % 2 ? s.gul._id : s.dhn._id,
        toBranchId: i % 2 ? s.dhn._id : s.gul._id,
        fromCode: i % 2 ? 'GUL' : 'DHN',
        toCode: i % 2 ? 'DHN' : 'GUL',
        items: [{ productId: s.product.id, sku: 'X', name: 'X', qty: 1 }],
        createdBy: s.owner.user.id,
        createdAt: new Date(base - (i === 30 ? 29 : i) * 1000), // #29 and #30 share an instant
      })),
      { timestamps: false }, // keep the createdAt values above
    );
    const first = await as(s.managerGul.token).get('/api/b/GUL/transfers');
    expect(first.body.items).toHaveLength(50);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await as(s.managerGul.token).get(
      `/api/b/GUL/transfers?cursor=${encodeURIComponent(first.body.nextCursor)}`,
    );
    expect(second.body.items).toHaveLength(5);
    expect(second.body.nextCursor).toBeNull();
    const all = [...first.body.items, ...second.body.items].map((r: TransferRowDto) => r.transferNo);
    expect(new Set(all).size).toBe(55);
  });

  it('a transfer between two OTHER branches is a 404 (DHN → UTT seen from GUL)', async () => {
    const s = await shopWithStock(0);
    await as(s.owner.token).post('/api/branches').send({ code: 'UTT', name: 'Uttara' });
    invalidateCache();
    await stockUp(s.owner.token, 'DHN', [{ productId: s.product.id, qty: 5, unitCost: 100 }]);
    const t = await makeTransfer(s.owner.token, 'DHN', 'UTT', [{ productId: s.product.id, qty: 1 }]);
    expect((await as(s.owner.token).get(`/api/b/GUL/transfers/${t.id}`)).status).toBe(404);
    expect((await as(s.managerGul.token).get(`/api/b/GUL/transfers/${t.id}`)).status).toBe(404);
    expect((await as(s.owner.token).get(`/api/b/UTT/transfers/${t.id}`)).body.transfer.direction).toBe(
      'incoming',
    );
  });

  it('product detail shows units in transit while the truck is on the road (FR-TRF-07)', async () => {
    const s = await shopWithStock(10);
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 4 }]);
    const detail = () => as(s.owner.token).get(`/api/products/${s.product.id}`);
    expect((await detail()).body.inTransit).toEqual([]); // pending: still on the GUL shelf
    await dispatch(s.managerGul.token, 'GUL', t.id);
    expect((await detail()).body.inTransit).toEqual([{ from: 'GUL', to: 'DHN', qty: 4 }]);
    expect((await as(s.managerDhn.token).get(`/api/products/${s.product.id}`)).body.inTransit).toEqual([
      { from: 'GUL', to: 'DHN', qty: 4 },
    ]); // the destination sees it coming
    await receiveTransfer(s.managerDhn.token, 'DHN', t.id);
    expect((await detail()).body.inTransit).toEqual([]);
  });

  it('a cashier can neither see nor manage transfers', async () => {
    const s = await shopWithStock(10);
    expect((await as(s.cashierGul.token).get('/api/b/GUL/transfers')).status).toBe(403);
    const create = await as(s.cashierGul.token)
      .post('/api/b/GUL/transfers')
      .send({ toBranchCode: 'DHN', lines: [{ productId: s.product.id, qty: 1 }] });
    expect(create.status).toBe(403);
    expect((await as(s.cashierGul.token).get(`/api/products/${s.product.id}`)).body.inTransit).toEqual([]);
  });

  it('every transfer detail has the names for the timeline', async () => {
    const s = await shopWithStock(10);
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 1 }]);
    await dispatch(s.owner.token, 'GUL', t.id);
    await receiveTransfer(s.managerDhn.token, 'DHN', t.id);
    const d = (await as(s.managerDhn.token).get(`/api/b/DHN/transfers/${t.id}`)).body.transfer as TransferDto;
    expect(d).toMatchObject({
      createdByName: expect.stringMatching(/manager/),
      dispatchedByName: 'Karim Owner',
    });
    expect(d.receivedByName).toMatch(/manager/);
    expect(d.receivedAt).not.toBeNull();
  });
});
