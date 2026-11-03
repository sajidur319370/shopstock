import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  Inventory,
  Product,
  PurchaseOrder,
  Sale,
  SaleReturn,
  StockMovement,
  Supplier,
  Transfer,
} from '../src/db/models';

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

  it('the PO list is index-ordered, with or without a status/supplier filter', async () => {
    const branchId = new Types.ObjectId();
    const newest = { createdAt: -1, _id: -1 } as const;
    assertIndexed(await PurchaseOrder.find({ branchId }).sort(newest).explain('queryPlanner'));
    assertIndexed(
      await PurchaseOrder.find({ branchId, status: 'ordered' }).sort(newest).explain('queryPlanner'),
    );
    assertIndexed(
      await PurchaseOrder.find({ branchId, supplierId: new Types.ObjectId() })
        .sort(newest)
        .explain('queryPlanner'),
    );
  });

  it('the transfers list is index-ordered: incoming, outgoing, both, and by status', async () => {
    const branchId = new Types.ObjectId();
    const newest = { createdAt: -1, _id: -1 } as const;
    const plan = (filter: Record<string, unknown>) =>
      Transfer.find(filter).sort(newest).explain('queryPlanner');
    assertIndexed(await plan({ $and: [{ toBranchId: branchId }] }));
    assertIndexed(await plan({ $and: [{ fromBranchId: branchId }, { status: 'pending' }] }));
    // both directions: two index scans merged in order (SORT_MERGE), never an in-memory SORT
    assertIndexed(await plan({ $and: [{ $or: [{ fromBranchId: branchId }, { toBranchId: branchId }] }] }));
  });

  it('suppliers: A→Z active list and prefix search use an index', async () => {
    assertIndexed(
      await Supplier.find({ isActive: true, nameLower: { $regex: '^meg' } })
        .sort({ nameLower: 1 })
        .explain('queryPlanner'),
    );
  });

  it("the returns list is index-ordered; a sale's returns are an index seek", async () => {
    const branchId = new Types.ObjectId();
    assertIndexed(
      await SaleReturn.find({ branchId }).sort({ createdAt: -1, _id: -1 }).explain('queryPlanner'),
    );
    // A sale has a handful of returns: sorting those in memory is fine, scanning the collection is not.
    const plan = await SaleReturn.find({ branchId, saleId: new Types.ObjectId() }).explain('queryPlanner');
    expect(JSON.stringify(plan)).toContain('IXSCAN');
    expect(JSON.stringify(plan)).not.toContain('COLLSCAN');
  });
});
