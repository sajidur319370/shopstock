import { useMemo } from 'react';
import { discountViolations, priceCart } from '@shopstock/shared';
import { useActor } from '@/features/auth/useActor';
import { useCart } from './cartStore';

/**
 * Live totals from the SAME priceCart() + discountViolations() the server runs (Day 11):
 * unless a price changed (→ PRICE_CHANGED), these numbers are the numbers on the receipt.
 */
export function usePricedCart() {
  const { settings } = useActor();
  const lines = useCart((s) => s.lines);
  const cartDiscount = useCart((s) => s.cartDiscount);
  return useMemo(() => {
    const priced = priceCart(
      lines.map((l) => ({
        productId: l.productId,
        unitPrice: l.unitPrice,
        qty: l.qty,
        discount: l.discount,
      })),
      cartDiscount,
      settings.taxRateBps,
    );
    return { priced, violations: discountViolations(priced, settings.discountCapBps) };
  }, [lines, cartDiscount, settings.taxRateBps, settings.discountCapBps]);
}
