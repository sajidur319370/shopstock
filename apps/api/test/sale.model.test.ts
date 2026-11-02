import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Sale } from '../src/db/models';

/** A minimal valid sale document (the real service on Day 11 builds these from priceCart()). */
const sale = (over: Record<string, unknown> = {}) => ({
  branchId: new Types.ObjectId(),
  branchCode: 'GUL',
  invoiceNo: `GUL-${Math.floor(Math.random() * 1e6)}`,
  seq: 1,
  clientSaleId: '3f2b1a4c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
  cashierId: new Types.ObjectId(),
  cashierName: 'Rafi',
  items: [
    {
      productId: new Types.ObjectId(),
      sku: 'RICE-5KG',
      name: 'Rice',
      qty: 1,
      unitPrice: 100,
      unitCost: 80,
      lineDiscount: 0,
      cartShare: 0,
      net: 100,
      tax: 5,
      total: 105,
    },
  ],
  taxRateBps: 500,
  totals: { subtotal: 100, discount: 0, net: 100, tax: 5, total: 105, cost: 80, itemCount: 1 },
  payments: [{ method: 'cash', amount: 105 }],
  change: 0,
  businessDate: '2026-11-02',
  createdAt: new Date(),
  ...over,
});

describe('sales model', () => {
  it('a sale without branchId fails validation', async () => {
    await expect(Sale.create(sale({ branchId: undefined }))).rejects.toThrow(/branchId/);
  });

  it('the same (branchId, clientSaleId) twice → uniq_client_sale (the idempotency guarantee)', async () => {
    const branchId = new Types.ObjectId();
    await Sale.create(sale({ branchId }));
    await expect(Sale.create(sale({ branchId }))).rejects.toMatchObject({
      code: 11000,
      message: expect.stringContaining('uniq_client_sale'),
    });
    // …but the same key at ANOTHER branch is a different sale
    await expect(Sale.create(sale({ branchId: new Types.ObjectId() }))).resolves.toBeTruthy();
  });

  it('even a lookup by a globally unique field must be branch-scoped (guard)', async () => {
    await expect(Sale.find({ invoiceNo: 'GUL-000001' })).rejects.toThrow(/without branchId/);
    await expect(Sale.find({ invoiceNo: 'GUL-000001', branchId: new Types.ObjectId() })).resolves.toEqual([]);
  });

  it('money fields must be whole minor units; a line keeps its own _id (saleLineId)', async () => {
    const bad = sale();
    (bad.items[0] as { unitPrice: number }).unitPrice = 12.5;
    await expect(Sale.create(bad)).rejects.toThrow(/integer/);
    const ok = await Sale.create(sale());
    expect(ok.items[0]!._id).toBeInstanceOf(Types.ObjectId);
  });
});
