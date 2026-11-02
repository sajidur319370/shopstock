import fc from 'fast-check';
import { describe, it } from 'vitest';
import { BPS } from '../src/constants';
import { allocate, discountViolations, priceCart, refundPart, type Discount } from '../src/pricing';

const discount: fc.Arbitrary<Discount | null> = fc.oneof(
  fc.constant(null),
  fc.record({ type: fc.constant('percent' as const), bps: fc.integer({ min: 0, max: BPS }) }),
  fc.record({ type: fc.constant('amount' as const), amount: fc.integer({ min: 0, max: 5_000_000 }) }),
);
const line = fc.record({
  productId: fc.uuid(),
  unitPrice: fc.integer({ min: 1, max: 10_000_000 }),
  qty: fc.integer({ min: 1, max: 9_999 }),
  discount,
});

describe('pricing properties (AC-PRC-01)', () => {
  it('holds for every cart (10,000 random carts)', () => {
    fc.assert(
      fc.property(
        fc.array(line, { minLength: 1, maxLength: 30 }),
        discount,
        fc.integer({ min: 0, max: 5_000 }),
        (lines, cd, tax) => {
          const c = priceCart(lines, cd, tax);
          const sum = (k: 'cartShare' | 'net' | 'tax' | 'total') => c.lines.reduce((s, l) => s + l[k], 0);
          return (
            sum('cartShare') === c.cartDiscount &&
            c.lines.every((l) => l.net >= 0 && l.total === l.net + l.tax && l.cartShare <= l.base) &&
            c.net === sum('net') &&
            c.tax === sum('tax') &&
            c.total === c.net + c.tax &&
            c.subtotal - c.discount === c.net &&
            Number.isSafeInteger(c.total)
          );
        },
      ),
      { numRuns: 10_000 },
    );
  });

  it('a percent discount at exactly the cap never violates it', () => {
    fc.assert(
      fc.property(
        fc.array(line, { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: BPS }),
        (lines, cap) => {
          const atCap = lines.map((l) => ({ ...l, discount: { type: 'percent' as const, bps: cap } }));
          return discountViolations(priceCart(atCap, null, 0), cap).length === 0;
        },
      ),
      { numRuns: 2_000 },
    );
  });

  it('allocate always sums exactly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e9 }),
        fc.array(fc.integer({ min: 0, max: 1e13 }), { minLength: 1, maxLength: 50 }),
        (total, w) => {
          const shares = allocate(total, w);
          return w.every((x) => x === 0)
            ? shares.every((s) => s === 0)
            : shares.reduce((a, b) => a + b, 0) === total && shares.every((s) => s >= 0);
        },
      ),
      { numRuns: 5_000 },
    );
  });

  it('refunds in any split add up to the line value', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 1, max: 50 }), (x, n) => {
        let returned = 0;
        let sum = 0;
        while (returned < n) {
          const q = Math.min(n - returned, 1 + (returned % 3));
          sum += refundPart(x, n, returned, q);
          returned += q;
        }
        return sum === x;
      }),
      { numRuns: 5_000 },
    );
  });
});
