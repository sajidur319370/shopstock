import { describe, expect, it, vi } from 'vitest';
import { sell, shopWithStock } from './factories/sales';
import { makeCategory, makeProduct } from './factories/catalog';
import { stockUp } from './factories/stock';
import { Inventory, Sale, StockMovement } from '../src/db/models';
import { oid } from '../src/lib/ids';

// Only in this file: the friendly pre-check always passes, so line 3 fails INSIDE the transaction.
// (Timing a real race for this would be flaky; switching the pre-check off makes it deterministic.)
vi.mock('../src/modules/inventory/stock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/modules/inventory/stock')>()),
  assertStockAvailable: vi.fn(async () => {}),
}));

describe('rollback', () => {
  it('a failing line rolls back the others AND the invoice number (AC-SAL-04)', async () => {
    const s = await shopWithStock(5); // oil: 5
    const cat = await makeCategory(s.owner.token);
    const rice = await makeProduct(s.owner.token, { categoryId: cat.id, name: 'Rice' });
    const tea = await makeProduct(s.owner.token, { categoryId: cat.id, name: 'Tea' }); // never stocked
    await stockUp(s.owner.token, 'GUL', [{ productId: rice.id, qty: 5, unitCost: 100 }]);
    const movementsBefore = await StockMovement.countDocuments({ branchId: s.gul._id });

    const res = await sell(s.cashierGul.token, 'GUL', [
      { productId: s.product.id, qty: 2 },
      { productId: rice.id, qty: 2 },
      { productId: tea.id, qty: 1 },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details).toEqual([{ productId: tea.id, name: 'Tea', requested: 1, available: 0 }]);

    const qty = async (id: string) =>
      (await Inventory.findOne({ branchId: s.gul._id, productId: oid(id) }).lean())!.quantity;
    expect(await qty(s.product.id)).toBe(5); // line 1 rolled back
    expect(await qty(rice.id)).toBe(5); // line 2 rolled back
    expect(await Sale.countDocuments({ branchId: s.gul._id })).toBe(0);
    expect(await StockMovement.countDocuments({ branchId: s.gul._id })).toBe(movementsBefore); // no stray movements

    const next = await sell(s.cashierGul.token, 'GUL', [{ productId: rice.id, qty: 1 }]);
    expect(next.body.sale.invoiceNo).toBe('GUL-000001'); // the failed sale didn't consume a number
  });
});
