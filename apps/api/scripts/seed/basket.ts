import { randomUUID } from 'node:crypto';
import { priceCart, type CreateSaleInput, type Discount, type PaymentMethod } from '@shopstock/shared';
import { chance, pick, randInt, type Rand } from '../../src/lib/random';

export type CatalogItem = { id: string; price: number };

/**
 * database.md §11: 1–6 distinct lines, ~10% with a 5% or 10% cart discount (within the cashier's 10%
 * cap), cash 70% / card 15% / mobile 15%. Card and mobile pay the exact total, computed with the SAME
 * priceCart the POS uses; cash pays it rounded up to the next ৳100, so `change` follows.
 * Every random number is drawn here, BEFORE anything runs: the history doesn't depend on timing.
 */
export function randomBasket(r: Rand, catalog: CatalogItem[], taxRateBps: number): CreateSaleInput {
  const n = randInt(r, 1, 6);
  const picked = new Map<string, CatalogItem>();
  while (picked.size < n) {
    const p = pick(r, catalog);
    picked.set(p.id, p);
  }
  const lines = [...picked.values()].map((p) => ({ productId: p.id, qty: randInt(r, 1, 3) }));
  const discount: Discount | null = chance(r, 0.1) ? { type: 'percent', bps: pick(r, [500, 1000]) } : null;
  const total = priceCart(
    lines.map((l) => ({ ...l, unitPrice: picked.get(l.productId)!.price, discount: null })),
    discount,
    taxRateBps,
  ).total;
  const roll = r();
  const method: PaymentMethod = roll < 0.7 ? 'cash' : roll < 0.85 ? 'card' : 'mobile';
  const amount = method === 'cash' ? Math.ceil(total / 10_000) * 10_000 : total;
  return {
    clientSaleId: randomUUID(),
    lines,
    discount,
    payments: [{ method, amount, ...(method !== 'cash' && { reference: String(randInt(r, 1000, 9999)) }) }],
  };
}
