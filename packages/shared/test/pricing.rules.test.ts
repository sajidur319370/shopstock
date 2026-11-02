import { describe, expect, it } from 'vitest';
import {
  allocate,
  discountAmount,
  discountViolations,
  mulDivFloor,
  mulDivHalfUp,
  priceCart,
  refundPart,
  settlePayments,
  type PaymentInput,
} from '../src/pricing';

describe('integer arithmetic', () => {
  it('floor and half-up never go through floats', () => {
    expect(mulDivFloor(7, 1, 2)).toBe(3);
    expect(mulDivHalfUp(7, 1, 2)).toBe(4); // 3.5 → 4
    expect(mulDivHalfUp(5, 1, 4)).toBe(1); // 1.25 → 1
    expect(mulDivFloor(1e13, 1e13, 1e13)).toBe(1e13); // 1e26 in the middle: exact via BigInt
  });
});

describe('discountAmount', () => {
  it('percent rounds DOWN', () => {
    expect(discountAmount(55500, { type: 'percent', bps: 500 })).toBe(2775);
    expect(discountAmount(999, { type: 'percent', bps: 1000 })).toBe(99); // 99.9 → 99, never 100
  });
  it('amount is capped at the base', () =>
    expect(discountAmount(500, { type: 'amount', amount: 800 })).toBe(500));
  it('no discount', () => {
    expect(discountAmount(500, null)).toBe(0);
    expect(discountAmount(500)).toBe(0);
  });
});

describe('allocate', () => {
  it('largest remainder, ties to the earlier line', () => {
    expect(allocate(7621, [90000, 52725, 9700])).toEqual([4500, 2636, 485]);
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]); // equal remainders → first lines get the extra unit
    expect(allocate(1, [1, 3])).toEqual([0, 1]); // the LARGER remainder wins over the earlier line
    expect(allocate(10, [0, 0])).toEqual([0, 0]); // nothing to weigh
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(6, [1, 2, 3])).toEqual([1, 2, 3]); // exact: no leftover at all
  });
  it('huge values stay exact (BigInt path)', () => {
    const w = [9_000_000_000_000, 1];
    expect(allocate(999_999_999, w).reduce((a, b) => a + b, 0)).toBe(999_999_999);
  });
});

describe('priceCart', () => {
  it('tax rounds half UP per line', () => {
    const c = priceCart([{ productId: 'a', unitPrice: 9215, qty: 1 }], null, 500); // 460.75 → 461
    expect(c.lines[0]!.tax).toBe(461);
    const d = priceCart([{ productId: 'a', unitPrice: 50090, qty: 1 }], null, 500); // 2504.5 → 2505
    expect(d.lines[0]!.tax).toBe(2505);
  });
  it('zero tax rate', () =>
    expect(priceCart([{ productId: 'a', unitPrice: 100, qty: 3 }], null, 0).tax).toBe(0));
  it('an amount cart discount larger than the cart is capped: net 0, never negative', () => {
    const c = priceCart([{ productId: 'a', unitPrice: 100, qty: 2 }], { type: 'amount', amount: 999 }, 500);
    expect(c).toMatchObject({ cartDiscount: 200, net: 0, tax: 0, total: 0 });
  });
});

describe('discountViolations (FR-PRC-04)', () => {
  it('a 10% line discount at a 10% cap passes; 10% + 10% cart fails (AC-PRC-02)', () => {
    const line = [
      { productId: 'a', unitPrice: 10000, qty: 1, discount: { type: 'percent' as const, bps: 1000 } },
    ];
    expect(discountViolations(priceCart(line, null, 0), 1000)).toEqual([]);
    const both = priceCart(line, { type: 'percent', bps: 1000 }, 0); // 1000 + 900 = 19%
    expect(discountViolations(both, 1000)).toEqual([{ productId: null, rateBps: 1900 }]);
  });
  it('one big line discount fails even if the cart total is small', () => {
    const c = priceCart(
      [
        { productId: 'a', unitPrice: 1000, qty: 1, discount: { type: 'amount', amount: 500 } },
        { productId: 'b', unitPrice: 100_000, qty: 1 },
      ],
      null,
      0,
    );
    expect(discountViolations(c, 1000)).toEqual([{ productId: 'a', rateBps: 5000 }]);
  });
  it('the reported rate rounds UP, so a violation never shows as "within the cap"', () => {
    const c = priceCart(
      [{ productId: 'a', unitPrice: 9999, qty: 1, discount: { type: 'amount', amount: 1001 } }],
      null,
      0,
    );
    expect(discountViolations(c, 1000)).toEqual([
      { productId: 'a', rateBps: 1002 }, // 1001 / 9999 = 10.011% → 1002 bps
      { productId: null, rateBps: 1002 },
    ]);
  });
  it('the owner (10000) is never limited', () => {
    const c = priceCart(
      [{ productId: 'a', unitPrice: 1000, qty: 1, discount: { type: 'amount', amount: 1000 } }],
      null,
      0,
    );
    expect(discountViolations(c, 10_000)).toEqual([]);
  });
});

describe('settlePayments (FR-PRC-07)', () => {
  it.each([
    [[{ method: 'card', amount: 1000 }], { ok: true, change: 0 }],
    [[{ method: 'card', amount: 1200 }], { ok: false }], // card over the total
    [[{ method: 'cash', amount: 900 }], { ok: false }], // short
    [
      [
        { method: 'card', amount: 600 },
        { method: 'cash', amount: 500 },
      ],
      { ok: true, change: 100 },
    ],
    [
      [
        { method: 'cash', amount: 500 },
        { method: 'cash', amount: 500 },
      ],
      { ok: false },
    ], // one payment per method
  ] as const)('%j', (payments, expected) => {
    expect(settlePayments(1000, payments as unknown as PaymentInput[])).toMatchObject(expected);
  });
  it('explains WHY a payment fails', () => {
    expect(settlePayments(1000, [{ method: 'cash', amount: 900 }])).toEqual({
      ok: false,
      reason: 'Payment is short by 100.',
    });
  });
});

describe('refundPart (FR-RET-04, AC-RET-02)', () => {
  it('333 + 334 + 333 = 1000', () => {
    expect([refundPart(1000, 3, 0, 1), refundPart(1000, 3, 1, 1), refundPart(1000, 3, 2, 1)]).toEqual([
      333, 334, 333,
    ]);
  });
  it('2 + 1 also adds up', () => expect(refundPart(1000, 3, 0, 2) + refundPart(1000, 3, 2, 1)).toBe(1000));
});
