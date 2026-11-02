import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Inventory, Product, Sale, StockMovement } from '../src/db/models';

/**
 * TR-10: hot queries must use an index and never sort in memory. Grows with every hot query.
 * Only the WINNING plan counts: the rejected alternatives often contain a SORT, by design.
 */
const assertIndexed = (plan: unknown) => {
  const text = JSON.stringify((plan as { queryPlanner: { winningPlan: unknown } }).queryPlanner.winningPlan);
  expect(text).toContain('IXSCAN');
  expect(text).not.toContain('COLLSCAN');
  expect(text).not.toMatch(/"stage":"SORT"/); // the sort comes from the index
};

describe('index usage', () => {
  it('prefix search uses { isActive, nameLower }', async () => {
    const plan = await Product.find({ isActive: true, nameLower: { $regex: '^soy' } })
      .sort({ nameLower: 1 })
      .explain('queryPlanner');
    assertIndexed(plan);
  });

  it('list by category uses { categoryId, nameLower }', async () => {
    const plan = await Product.find({ categoryId: new Types.ObjectId() })
      .sort({ nameLower: 1 })
      .explain('queryPlanner');
    assertIndexed(plan);
  });

  it('barcode and SKU lookups are single index seeks', async () => {
    assertIndexed(
      await Product.findOne({ barcode: '8941100500017', isActive: true }).explain('queryPlanner'),
    );
    assertIndexed(await Product.findOne({ sku: 'RICE-5KG', isActive: true }).explain('queryPlanner'));
  });

  it('movement feed and product history are index-ordered (newest first)', async () => {
    const branchId = new Types.ObjectId();
    assertIndexed(
      await StockMovement.find({ branchId }).sort({ createdAt: -1, _id: -1 }).explain('queryPlanner'),
    );
    assertIndexed(
      await StockMovement.find({ branchId, productId: new Types.ObjectId() })
        .sort({ createdAt: -1, _id: -1 })
        .explain('queryPlanner'),
    );
  });

  it('one inventory row is a unique-index seek', async () => {
    const plan = await Inventory.findOne({
      branchId: new Types.ObjectId(),
      productId: new Types.ObjectId(),
    }).explain('queryPlanner');
    assertIndexed(plan);
    expect(JSON.stringify(plan)).toContain('uniq_inventory_row');
  });

  it('sales history is index-ordered, for managers (whole branch) and cashiers (own sales)', async () => {
    const branchId = new Types.ObjectId();
    assertIndexed(await Sale.find({ branchId }).sort({ createdAt: -1, _id: -1 }).explain('queryPlanner'));
    assertIndexed(
      await Sale.find({ branchId, cashierId: new Types.ObjectId() })
        .sort({ createdAt: -1, _id: -1 })
        .explain('queryPlanner'),
    );
  });
});
