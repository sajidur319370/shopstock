import { beforeEach, describe, expect, it } from 'vitest';
import type { InventoryRowDto, ProductDto } from '@shopstock/shared';
import { as } from './helpers/auth';
import { makeShop, type Shop } from './factories/shop';
import { makeCategory, makeProduct } from './factories/catalog';
import { stockUp } from './factories/stock';
import { Inventory, StockMovement } from '../src/db/models';

describe('adjustments, stock counts & inventory reads', () => {
  let s: Shop;
  let rice: ProductDto;
  let dal: ProductDto;
  let salt: ProductDto;
  beforeEach(async () => {
    s = await makeShop();
    const cat = await makeCategory(s.owner.token, 'Groceries');
    rice = await makeProduct(s.owner.token, { categoryId: cat.id, name: 'Rice 5kg', reorderLevel: 4 });
    dal = await makeProduct(s.owner.token, { categoryId: cat.id, name: 'Dal 1kg' });
    salt = await makeProduct(s.owner.token, { categoryId: cat.id, name: 'Salt 1kg' });
  });

  const qty = async (p: ProductDto, branchId = s.gul._id) =>
    (await Inventory.findOne({ branchId, productId: p.id }).lean())?.quantity ?? null;
  const adjust = (token: string, body: object, code = 'GUL') =>
    as(token).post(`/api/b/${code}/adjustments`).send(body);

  it('AC-INV-01: line 3 short → whole batch rolls back, including its number', async () => {
    const res = await adjust(s.managerGul.token, {
      reason: 'count_correction',
      lines: [
        { productId: rice.id, qtyChange: 2, unitCost: 100 },
        { productId: dal.id, qtyChange: 3, unitCost: 100 },
        { productId: salt.id, qtyChange: -1 }, // never stocked
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: [{ productId: salt.id, available: 0 }],
    });
    expect(await qty(rice)).toBeNull(); // lines 1–2 didn't happen either
    expect(await qty(dal)).toBeNull();
    const next = await stockUp(s.owner.token, 'GUL', [{ productId: rice.id, qty: 1, unitCost: 100 }]);
    expect(next.refNo).toBe('GUL-ADJ-000001'); // the failed batch didn't burn a number
  });

  it('reason and sign must agree; opening stock needs a cost', async () => {
    const damagedUp = await adjust(s.managerGul.token, {
      reason: 'damaged',
      lines: [{ productId: rice.id, qtyChange: 1, unitCost: 100 }],
    });
    expect(damagedUp.body.error.code).toBe('INVALID_REASON');
    const openingNoCost = await adjust(s.managerGul.token, {
      reason: 'opening_balance',
      lines: [{ productId: rice.id, qtyChange: 5 }],
    });
    expect(openingNoCost.body.error.code).toBe('UNIT_COST_REQUIRED');
  });

  it('found without a cost keeps avgCost on a stocked product; on a never-stocked one → 400', async () => {
    await stockUp(s.owner.token, 'GUL', [{ productId: rice.id, qty: 10, unitCost: 42000 }]);
    const found = await adjust(s.managerGul.token, {
      reason: 'found',
      lines: [{ productId: rice.id, qtyChange: 2 }],
    });
    expect(found.status).toBe(201);
    expect(await Inventory.findOne({ branchId: s.gul._id, productId: rice.id }).lean()).toMatchObject({
      quantity: 12,
      avgCost: 42000,
    });
    const fresh = await adjust(s.managerGul.token, {
      reason: 'found',
      lines: [{ productId: dal.id, qtyChange: 2 }],
    });
    expect(fresh.body.error.code).toBe('UNIT_COST_REQUIRED');
  });

  it('an unknown product → 400 INVALID_PRODUCT', async () => {
    const res = await adjust(s.managerGul.token, {
      reason: 'opening_balance',
      lines: [{ productId: '0123456789abcdef01234567', qtyChange: 1, unitCost: 1 }],
    });
    expect(res.body.error.code).toBe('INVALID_PRODUCT');
  });

  it('AC-INV-02: a count made on a stale screen → 409 STOCK_CHANGED (all lines reported), nothing changes', async () => {
    await stockUp(s.owner.token, 'GUL', [
      { productId: rice.id, qty: 10, unitCost: 100 },
      { productId: dal.id, qty: 5, unitCost: 100 },
    ]);
    await adjust(s.managerGul.token, { reason: 'lost', lines: [{ productId: rice.id, qtyChange: -1 }] }); // a "sale" while counting
    await adjust(s.managerGul.token, { reason: 'lost', lines: [{ productId: dal.id, qtyChange: -1 }] });

    const res = await as(s.managerGul.token)
      .post('/api/b/GUL/stock-counts')
      .send({
        lines: [
          { productId: rice.id, expectedQty: 10, countedQty: 8 },
          { productId: dal.id, expectedQty: 5, countedQty: 5 },
        ],
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STOCK_CHANGED');
    expect(res.body.error.details).toEqual([
      { productId: rice.id, expected: 10, current: 9 },
      { productId: dal.id, expected: 5, current: 4 },
    ]);
    expect([await qty(rice), await qty(dal)]).toEqual([9, 4]);
  });

  it('a correct stock count writes one count_correction movement per CHANGED line', async () => {
    await stockUp(s.owner.token, 'GUL', [
      { productId: rice.id, qty: 10, unitCost: 100 },
      { productId: dal.id, qty: 5, unitCost: 100 },
    ]);
    const res = await as(s.managerGul.token)
      .post('/api/b/GUL/stock-counts')
      .send({
        note: 'Monthly count',
        lines: [
          { productId: rice.id, expectedQty: 10, countedQty: 8 }, // −2
          { productId: dal.id, expectedQty: 5, countedQty: 5 }, // same: no movement
          { productId: salt.id, expectedQty: 0, countedQty: 3, unitCost: 4200 }, // never stocked: +3
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ refNo: 'GUL-ADJ-000002', lines: 2 });
    expect([await qty(rice), await qty(dal), await qty(salt)]).toEqual([8, 5, 3]);
    const moves = await StockMovement.find({ branchId: s.gul._id, refNo: 'GUL-ADJ-000002' }).lean();
    expect(moves.map((m) => [m.qtyChange, m.reason, m.note]).sort()).toEqual([
      [-2, 'count_correction', 'Monthly count'],
      [3, 'count_correction', 'Monthly count'],
    ]);
  });

  it('nothing differs → no number, no movement', async () => {
    await stockUp(s.owner.token, 'GUL', [{ productId: rice.id, qty: 10, unitCost: 100 }]);
    const res = await as(s.managerGul.token)
      .post('/api/b/GUL/stock-counts')
      .send({ lines: [{ productId: rice.id, expectedQty: 10, countedQty: 10 }] });
    expect(res.body).toEqual({ refNo: null, refId: null, lines: 0 });
  });

  it('inventory list: never-stocked shows not_stocked; cashiers get NO cost fields, managers do', async () => {
    await stockUp(s.owner.token, 'GUL', [
      { productId: rice.id, qty: 3, unitCost: 42000 }, // 3 ≤ reorder level 4 → low
      { productId: dal.id, qty: 9, unitCost: 13500 },
    ]);
    const asCashier = (await as(s.cashierGul.token).get('/api/b/GUL/inventory')).body
      .items as InventoryRowDto[];
    const byName = (rows: InventoryRowDto[]) => Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName(asCashier)['Rice 5kg']).toMatchObject({ quantity: 3, status: 'low' });
    expect(byName(asCashier)['Dal 1kg']).toMatchObject({ quantity: 9, status: 'ok' });
    expect(byName(asCashier)['Salt 1kg']).toMatchObject({ quantity: 0, status: 'not_stocked' });
    expect(JSON.stringify(asCashier)).not.toMatch(/avgCost|"value"/);

    const asManager = (await as(s.managerGul.token).get('/api/b/GUL/inventory')).body
      .items as InventoryRowDto[];
    expect(byName(asManager)['Rice 5kg']).toMatchObject({ avgCost: 42000, value: 126000 });

    // DHN never stocked anything: same catalog, all not_stocked.
    const dhn = (await as(s.cashierDhn.token).get('/api/b/DHN/inventory')).body.items as InventoryRowDto[];
    expect(dhn.every((r) => r.status === 'not_stocked')).toBe(true);
  });

  it('product detail: stock across MY branches; cost only for Manager+', async () => {
    await stockUp(s.owner.token, 'GUL', [{ productId: rice.id, qty: 3, unitCost: 42000 }]);
    await stockUp(s.owner.token, 'DHN', [{ productId: rice.id, qty: 7, unitCost: 41000 }]);
    const owner = await as(s.owner.token).get(`/api/products/${rice.id}`);
    expect(
      owner.body.stock.map((b: { branchCode: string; quantity: number }) => [b.branchCode, b.quantity]),
    ).toEqual([
      ['DHN', 7],
      ['GUL', 3],
    ]);
    expect(owner.body.stock[0].avgCost).toBe(41000);
    const cashier = await as(s.cashierGul.token).get(`/api/products/${rice.id}`);
    expect(cashier.body.stock).toEqual([
      { branchId: String(s.gul._id), branchCode: 'GUL', quantity: 3, reorderLevel: 4, status: 'low' },
    ]);
  });

  it('inventory row: movements only for managers; reorder level change writes NO movement', async () => {
    await stockUp(s.owner.token, 'GUL', [{ productId: rice.id, qty: 3, unitCost: 42000 }]);
    const mgr = await as(s.managerGul.token).get(`/api/b/GUL/inventory/${rice.id}`);
    expect(mgr.body.movements).toHaveLength(1);
    expect(mgr.body.movements[0]).toMatchObject({
      type: 'adjustment',
      reason: 'opening_balance',
      qtyChange: 3,
      unitCost: 42000,
    });
    const cashier = await as(s.cashierGul.token).get(`/api/b/GUL/inventory/${rice.id}`);
    expect(cashier.body.movements).toBeUndefined();

    const before = await StockMovement.countDocuments({ branchId: s.gul._id });
    const res = await as(s.managerGul.token)
      .patch(`/api/b/GUL/inventory/${rice.id}`)
      .send({ reorderLevel: 2 });
    expect(res.body.row).toMatchObject({ reorderLevel: 2, status: 'ok' });
    expect(await StockMovement.countDocuments({ branchId: s.gul._id })).toBe(before);
    const notStocked = await as(s.managerGul.token)
      .patch(`/api/b/GUL/inventory/${dal.id}`)
      .send({ reorderLevel: 2 });
    expect(notStocked.status).toBe(404);
  });

  it('movement feed: newest first, names hydrated, cost hidden from cashiers, cursor pages', async () => {
    await stockUp(s.owner.token, 'GUL', [{ productId: rice.id, qty: 40, unitCost: 100 }]);
    for (let i = 0; i < 31; i++) {
      await adjust(s.managerGul.token, { reason: 'lost', lines: [{ productId: rice.id, qtyChange: -1 }] });
    }
    const p1 = await as(s.managerGul.token).get('/api/b/GUL/movements');
    expect(p1.body.items).toHaveLength(30);
    expect(p1.body.items[0]).toMatchObject({
      refNo: 'GUL-ADJ-000032',
      productName: 'Rice 5kg',
      quantityAfter: 9,
    });
    expect(p1.body.items[0].userName).toMatch(/^manager/);
    const p2 = await as(s.managerGul.token).get(`/api/b/GUL/movements?cursor=${p1.body.nextCursor}`);
    expect(p2.body.items.map((m: { refNo: string }) => m.refNo)).toEqual([
      'GUL-ADJ-000002',
      'GUL-ADJ-000001',
    ]);
    expect(p2.body.nextCursor).toBeNull();
    expect((await as(s.cashierGul.token).get('/api/b/GUL/movements')).status).toBe(403);
  });

  it('deleting a stocked product → 409 PRODUCT_IN_USE; an unstocked one can go', async () => {
    await stockUp(s.owner.token, 'DHN', [{ productId: rice.id, qty: 1, unitCost: 100 }]); // stocked at ANOTHER branch
    expect((await as(s.managerGul.token).delete(`/api/products/${rice.id}`)).body.error.code).toBe(
      'PRODUCT_IN_USE',
    );
    expect((await as(s.managerGul.token).delete(`/api/products/${salt.id}`)).status).toBe(204);
  });

  it('GET /reconcile is Owner-only and reports a clean branch', async () => {
    await stockUp(s.owner.token, 'GUL', [{ productId: rice.id, qty: 5, unitCost: 100 }]);
    expect((await as(s.owner.token).get('/api/b/GUL/reconcile')).body).toEqual({ ok: true, mismatches: [] });
    expect((await as(s.managerGul.token).get('/api/b/GUL/reconcile')).status).toBe(403);
  });
});
