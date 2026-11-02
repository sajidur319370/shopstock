import { Types } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MovementType, ProductDto } from '@shopstock/shared';
import { as } from './helpers/auth';
import { ownerCtxFor } from './helpers/ctx';
import { makeShop, type Shop } from './factories/shop';
import { makeCategory, makeProduct } from './factories/catalog';
import { stockUp } from './factories/stock';
import { Inventory, StockMovement } from '../src/db/models';
import { withTransaction } from '../src/db/transaction';
import { oid } from '../src/lib/ids';
import { withStockChanges, type StockOps } from '../src/modules/inventory/stock';
import type { BranchCtx } from '../src/types/ctx';

describe('stock module', () => {
  let s: Shop;
  let oil: ProductDto;
  let ctx: BranchCtx;
  beforeEach(async () => {
    s = await makeShop();
    const cat = await makeCategory(s.owner.token);
    oil = await makeProduct(s.owner.token, { categoryId: cat.id, name: 'Soybean Oil 1L' });
    ctx = await ownerCtxFor(s.gul._id, 'GUL');
  });

  // Sales and receipts don't exist yet: drive the two doors directly, with their real movement types.
  const run = (type: MovementType, fn: (st: StockOps) => Promise<unknown>) =>
    withTransaction((session) =>
      withStockChanges(
        ctx,
        session,
        { refType: 'adjustment', refId: new Types.ObjectId(), refNo: `T-${type}` },
        fn,
      ),
    );
  const pid = () => oid(oil.id);
  const row = () => Inventory.findOne({ branchId: s.gul._id, productId: pid() }).lean();
  type AtExtra = { type: MovementType; unitCost?: number; reorderDefault?: number };
  const at = (qty: number, extra: AtExtra) => ({ branchId: s.gul._id, productId: pid(), qty, ...extra });

  it('weighted average cost follows data-model.md §11.4 exactly', async () => {
    await run('adjustment', (st) => st.in(at(20, { unitCost: 16000, type: 'adjustment' })));
    expect(await row()).toMatchObject({ quantity: 20, avgCost: 16000 });

    const out = await run('sale', (st) => st.out(at(3, { type: 'sale' })));
    expect(out).toMatchObject({ quantityAfter: 17, unitCost: 16000 }); // stock-out keeps the average

    await run('purchase_receipt', (st) => st.in(at(30, { unitCost: 17000, type: 'purchase_receipt' })));
    expect(await row()).toMatchObject({ quantity: 47, avgCost: 16638 }); // round((17×16000 + 30×17000) / 47)

    await run('transfer_out', (st) => st.out(at(10, { type: 'transfer_out' })));
    await run('return', (st) => st.in(at(1, { unitCost: 16000, type: 'return' })));
    expect(await row()).toMatchObject({ quantity: 38, avgCost: 16621 }); // round((37×16638 + 16000) / 38)

    await run('adjustment', (st) => st.out(at(2, { type: 'adjustment' })));
    expect(await row()).toMatchObject({ quantity: 36, avgCost: 16621 });

    const moves = await StockMovement.find({ branchId: s.gul._id, productId: pid() })
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    expect(moves.map((m) => m.qtyChange)).toEqual([20, -3, 30, -10, 1, -2]);
    expect(moves.map((m) => m.type)).toEqual([
      'adjustment',
      'sale',
      'purchase_receipt',
      'transfer_out',
      'return',
      'adjustment',
    ]);
    expect(moves.at(-1)).toMatchObject({ quantityAfter: 36, unitCost: 16621, valueChange: -33242 });
  });

  it('first stock-in creates the row with the product default reorder level', async () => {
    await run('adjustment', (st) => st.in(at(4, { unitCost: 500, type: 'adjustment', reorderDefault: 7 })));
    expect(await row()).toMatchObject({ quantity: 4, avgCost: 500, reorderLevel: 7 });
    expect((await row())!.createdAt).toBeInstanceOf(Date); // set by hand: pipelines skip timestamps
  });

  it('stock out more than on hand → INSUFFICIENT_STOCK, nothing changes', async () => {
    await run('adjustment', (st) => st.in(at(2, { unitCost: 100, type: 'adjustment' })));
    await expect(run('sale', (st) => st.out(at(3, { type: 'sale' })))).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: [{ requested: 3, available: 2 }],
    });
    expect((await row())!.quantity).toBe(2);
    expect(await StockMovement.countDocuments({ branchId: s.gul._id })).toBe(1);
  });

  it('a never-stocked product: out → available 0; in without cost → UNIT_COST_REQUIRED', async () => {
    await expect(run('sale', (st) => st.out(at(1, { type: 'sale' })))).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: [{ available: 0 }],
    });
    await expect(run('adjustment', (st) => st.in(at(1, { type: 'adjustment' })))).rejects.toMatchObject({
      code: 'UNIT_COST_REQUIRED',
    });
    expect(await row()).toBeNull();
  });

  it('the database itself rejects negative stock (AC-INV-03)', async () => {
    await run('adjustment', (st) => st.in(at(2, { unitCost: 100, type: 'adjustment' })));
    // Deliberately bypassing the stock module (tests aren't covered by the lint rule) to prove the validator.
    await expect(
      Inventory.updateOne({ branchId: s.gul._id, productId: pid() }, { $inc: { quantity: -1000 } }),
    ).rejects.toMatchObject({ code: 121 });
    expect((await row())!.quantity).toBe(2);
  });

  it('movements are append-only (AC-MOV-02)', async () => {
    await expect(StockMovement.updateOne({ branchId: s.gul._id }, { $set: { note: 'x' } })).rejects.toThrow(
      'append-only',
    );
    await expect(StockMovement.deleteMany({ branchId: s.gul._id })).rejects.toThrow('append-only');
    await expect(StockMovement.findOneAndUpdate({ branchId: s.gul._id }, { note: 'x' })).rejects.toThrow(
      'append-only',
    );
  });

  it('10 parallel write-offs against stock 3 → exactly 3 succeed, stock 0, gapless numbers', async () => {
    await stockUp(s.owner.token, 'GUL', [{ productId: oil.id, qty: 3, unitCost: 100 }]); // GUL-ADJ-000001
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        as(s.managerGul.token)
          .post('/api/b/GUL/adjustments')
          .send({ reason: 'lost', lines: [{ productId: oil.id, qtyChange: -1 }] }),
      ),
    );
    const ok = attempts.filter((r) => r.status === 201);
    expect(ok).toHaveLength(3);
    expect(
      attempts.filter((r) => r.status === 409).every((r) => r.body.error.code === 'INSUFFICIENT_STOCK'),
    ).toBe(true);
    expect((await row())!.quantity).toBe(0);
    expect(ok.map((r) => r.body.refNo).sort()).toEqual([
      'GUL-ADJ-000002',
      'GUL-ADJ-000003',
      'GUL-ADJ-000004',
    ]);
    expect(await StockMovement.countDocuments({ branchId: s.gul._id, productId: pid() })).toBe(4);
  });
});
