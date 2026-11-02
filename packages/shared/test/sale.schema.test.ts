import { describe, expect, it } from 'vitest';
import { createSaleSchema } from '../src/schemas/sale';

const valid = {
  clientSaleId: '3f2b1a4c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
  lines: [{ productId: '0123456789abcdef01234567', qty: 2 }],
  payments: [{ method: 'cash', amount: 1000 }],
};

describe('createSaleSchema', () => {
  it('strips any price a client sends (FR-PRC-03: the server re-prices from the DB)', () => {
    const parsed = createSaleSchema.parse({
      ...valid,
      lines: [{ ...valid.lines[0], unitPrice: 1, total: 1, unitCost: 0 }],
      totals: { total: 1 },
    });
    expect(parsed.lines[0]).toEqual({ productId: '0123456789abcdef01234567', qty: 2 });
    expect(parsed).not.toHaveProperty('totals');
  });

  it('discounts must be a known shape', () => {
    expect(createSaleSchema.safeParse({ ...valid, discount: { type: 'percent', bps: 500 } }).success).toBe(
      true,
    );
    expect(createSaleSchema.safeParse({ ...valid, discount: { type: 'amount', amount: 300 } }).success).toBe(
      true,
    );
    expect(createSaleSchema.safeParse({ ...valid, discount: { type: 'percent', bps: 10_001 } }).success).toBe(
      false,
    );
    expect(createSaleSchema.safeParse({ ...valid, discount: { type: 'free' } }).success).toBe(false);
    expect(createSaleSchema.safeParse({ ...valid, discount: { type: 'amount', amount: 2.5 } }).success).toBe(
      false,
    );
  });

  it('rejects a non-UUID key, fractional quantities and empty carts', () => {
    expect(createSaleSchema.safeParse({ ...valid, clientSaleId: '123' }).success).toBe(false);
    expect(createSaleSchema.safeParse({ ...valid, lines: [{ ...valid.lines[0], qty: 1.5 }] }).success).toBe(
      false,
    );
    expect(createSaleSchema.safeParse({ ...valid, lines: [] }).success).toBe(false);
    expect(createSaleSchema.safeParse({ ...valid, payments: [] }).success).toBe(false);
  });
});
