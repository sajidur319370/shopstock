import { describe, expect, it } from 'vitest';
import { discountViolations, priceCart, settlePayments } from '../src/pricing';

/** data-model.md §12.3, number for number: THE specification of the engine. */
const cart = () =>
  priceCart(
    [
      { productId: 'L1', unitPrice: 45000, qty: 2 }, // Miniket Rice 5kg
      { productId: 'L2', unitPrice: 18500, qty: 3, discount: { type: 'percent', bps: 500 } }, // Soybean Oil 1L, 5%
      { productId: 'L3', unitPrice: 2500, qty: 4, discount: { type: 'amount', amount: 300 } }, // Biscuits, ৳3.00
    ],
    { type: 'percent', bps: 500 }, // 5% cart discount
    500, // 5% tax
  );

describe('priceCart: the worked example', () => {
  it('lines', () => {
    expect(
      cart().lines.map(({ gross, lineDiscount, base, cartShare, net, tax, total }) => ({
        gross,
        lineDiscount,
        base,
        cartShare,
        net,
        tax,
        total,
      })),
    ).toEqual([
      { gross: 90000, lineDiscount: 0, base: 90000, cartShare: 4500, net: 85500, tax: 4275, total: 89775 },
      { gross: 55500, lineDiscount: 2775, base: 52725, cartShare: 2636, net: 50089, tax: 2504, total: 52593 },
      { gross: 10000, lineDiscount: 300, base: 9700, cartShare: 485, net: 9215, tax: 461, total: 9676 },
    ]);
  });

  it('totals', () => {
    expect(cart()).toMatchObject({
      subtotal: 155500,
      lineDiscounts: 3075,
      cartDiscount: 7621,
      discount: 10696,
      net: 144804,
      tax: 7240,
      total: 152044,
      itemCount: 9,
    });
  });

  it('cashier cap 10%: allowed', () => {
    expect(discountViolations(cart(), 1000)).toEqual([]);
  });

  it('cash 1550.00 → change 29.56', () => {
    expect(settlePayments(152044, [{ method: 'cash', amount: 155000 }])).toEqual({ ok: true, change: 2956 });
  });
});
