/**
 * THE PRICING ENGINE (queries.md §10): pure functions, no I/O. The POS calls it to SHOW totals,
 * the API calls it to CHARGE them: same code, so they can't disagree. Inputs are non-negative
 * integers: money in minor units, rates in basis points.
 */
import { BPS } from './constants';

// Number is exact only up to 2^53 ≈ 9.0e15. A gross (≤ 1e9 × 9,999 ≈ 1e13) fits, but PRODUCTS of two
// money values (discount × weight) can reach 1e26, so those multiply in BigInt.
const B = BigInt;

/** floor(a × b / c) for a, b ≥ 0, c > 0 */
export const mulDivFloor = (a: number, b: number, c: number) => Number((B(a) * B(b)) / B(c));

/** round_half_up(a × b / c) for a, b ≥ 0, c > 0 */
export const mulDivHalfUp = (a: number, b: number, c: number) =>
  Number((B(a) * B(b) * 2n + B(c)) / (2n * B(c)));

export type Discount = { type: 'percent'; bps: number } | { type: 'amount'; amount: number };

export interface CartLineInput {
  productId: string;
  unitPrice: number; // minor units (from the DB on the server; from the search result in the POS)
  qty: number;
  discount?: Discount | null;
}

export interface PricedLine extends CartLineInput {
  gross: number; // unitPrice × qty
  lineDiscount: number;
  base: number; // gross − lineDiscount
  cartShare: number; // this line's share of the cart discount
  net: number; // base − cartShare
  tax: number;
  total: number; // net + tax
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: number; // Σ gross
  lineDiscounts: number; // Σ lineDiscount
  cartDiscount: number;
  discount: number; // lineDiscounts + cartDiscount
  net: number;
  tax: number;
  total: number;
  itemCount: number; // Σ qty
}

/** Percent rounds DOWN (never more than the stated %); amounts are capped at the base. */
export function discountAmount(base: number, d?: Discount | null): number {
  if (!d) return 0;
  return d.type === 'percent' ? mulDivFloor(base, d.bps, BPS) : Math.min(d.amount, base);
}

/**
 * Largest-remainder split of `total` in proportion to `weights`: floor every share, then hand the
 * leftover units to the largest remainders (ties → the earlier line). Σ result === total, always.
 */
export function allocate(total: number, weights: number[]): number[] {
  const W = weights.reduce((s, w) => s + w, 0);
  if (total === 0 || W === 0) return weights.map(() => 0);
  const T = B(total);
  const WB = B(W);
  const parts = weights.map((w, i) => ({ i, share: Number((T * B(w)) / WB), rem: (T * B(w)) % WB }));
  let leftover = total - parts.reduce((s, p) => s + p.share, 0); // 0 ≤ leftover < weights.length
  const byRemainder = [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const p of byRemainder) {
    if (leftover === 0) break;
    p.share += 1;
    leftover -= 1;
  }
  return parts.map((p) => p.share);
}

/** Line discounts → cart discount (allocated by line base) → tax per line (half-up) → totals. */
export function priceCart(
  lines: CartLineInput[],
  cartDiscountInput: Discount | null,
  taxRateBps: number,
): PricedCart {
  const step1 = lines.map((l) => {
    const gross = l.unitPrice * l.qty;
    const lineDiscount = discountAmount(gross, l.discount);
    return { ...l, gross, lineDiscount, base: gross - lineDiscount };
  });

  const baseSum = step1.reduce((s, l) => s + l.base, 0);
  const cartDiscount = discountAmount(baseSum, cartDiscountInput);
  const shares = allocate(
    cartDiscount,
    step1.map((l) => l.base),
  );

  const priced: PricedLine[] = step1.map((l, i) => {
    const cartShare = shares[i]!;
    const net = l.base - cartShare;
    const tax = mulDivHalfUp(net, taxRateBps, BPS);
    return { ...l, cartShare, net, tax, total: net + tax };
  });

  const sum = (k: 'gross' | 'lineDiscount' | 'net' | 'tax' | 'total' | 'qty') =>
    priced.reduce((s, l) => s + l[k], 0);
  const subtotal = sum('gross');
  const lineDiscounts = sum('lineDiscount');
  return {
    lines: priced,
    subtotal,
    lineDiscounts,
    cartDiscount,
    discount: lineDiscounts + cartDiscount,
    net: sum('net'),
    tax: sum('tax'),
    total: sum('total'),
    itemCount: sum('qty'),
  };
}

export interface CapViolation {
  productId: string | null; // null = the whole cart
  rateBps: number;
}

/**
 * The rate in bps, rounded UP (so a violation can never display as "within the cap").
 * Only called when part > 0 and part × BPS > whole × cap, which implies whole > 0: a discount can't
 * exist without a price (prices ≥ 1, discounts are capped at the base). No division by zero.
 */
const rateBps = (part: number, whole: number) => Number((B(part) * B(BPS) + B(whole) - 1n) / B(whole));

/** FR-PRC-04: every line AND the cart as a whole must stay within the actor's cap. Integers only. */
export function discountViolations(cart: PricedCart, capBps: number): CapViolation[] {
  if (capBps >= BPS) return []; // the owner
  const over = (part: number, whole: number) => B(part) * B(BPS) > B(whole) * B(capBps);
  const v: CapViolation[] = cart.lines
    .filter((l) => over(l.lineDiscount, l.gross))
    .map((l) => ({ productId: l.productId, rateBps: rateBps(l.lineDiscount, l.gross) }));
  if (over(cart.discount, cart.subtotal))
    v.push({ productId: null, rateBps: rateBps(cart.discount, cart.subtotal) });
  return v;
}

export interface PaymentInput {
  method: 'cash' | 'card' | 'mobile';
  amount: number;
  reference?: string;
}

/** FR-PRC-07: one payment per method; card/mobile can't exceed the total; only cash gives change. */
export function settlePayments(
  total: number,
  payments: PaymentInput[],
): { ok: true; change: number } | { ok: false; reason: string } {
  if (new Set(payments.map((p) => p.method)).size !== payments.length) {
    return { ok: false, reason: 'One payment per method.' };
  }
  const nonCash = payments.filter((p) => p.method !== 'cash').reduce((s, p) => s + p.amount, 0);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  if (nonCash > total) return { ok: false, reason: 'Card/mobile payments exceed the amount due.' };
  if (paid < total) return { ok: false, reason: `Payment is short by ${total - paid}.` };
  return { ok: true, change: paid - total }; // ≤ the cash amount, because nonCash ≤ total
}

/** round_half_up(x × k / n) */
export const portion = (x: number, n: number, k: number) => mulDivHalfUp(x, k, n);

/** Refund for q units of a line after r were already returned. Telescopes: Σ over all returns === x. */
export const refundPart = (x: number, n: number, r: number, q: number) =>
  portion(x, n, r + q) - portion(x, n, r);
