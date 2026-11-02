import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatMoney, type PaymentInput, type PricedCart, type SaleDto } from '@shopstock/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { useCart, usePosUi } from './cartStore';

type Args = { payments: PaymentInput[]; expectedTotal: number };

/**
 * "Did it go through?" is unknowable when the response never arrived (status 0), the proxy failed
 * (NETWORK_ERROR with a 5xx), or the server crashed (5xx). In all of those, Retry is SAFE: it resends
 * the SAME clientSaleId, so the worst case is "already completed", never a second charge.
 */
export const isUncertain = (err: unknown) =>
  err instanceof ApiError && (err.status === 0 || err.code === 'NETWORK_ERROR' || err.status >= 500);

export function useCompleteSale() {
  const branch = useBranch();
  const { settings } = useActor();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const lastArgs = useRef<Args | null>(null);

  const mutation = useMutation({
    retry: false, // retries are the CASHIER's decision, with the SAME clientSaleId
    mutationFn: (args: Args) => {
      lastArgs.current = args;
      const s = useCart.getState(); // read at send time: clientSaleId is unchanged on a retry
      return http.post<{ sale: SaleDto; replayed: boolean }>(`/b/${branch.code}/sales`, {
        clientSaleId: s.clientSaleId,
        lines: s.lines.map((l) => ({ productId: l.productId, qty: l.qty, discount: l.discount })),
        discount: s.cartDiscount,
        payments: args.payments,
        customer: s.customer.name || s.customer.phone ? s.customer : undefined,
        expectedTotal: args.expectedTotal,
      });
    },
    onSuccess: ({ sale, replayed }) => {
      if (replayed) toast.info(`${sale.invoiceNo} was already completed. No double charge.`);
      useCart.getState().reset(branch.code); // a NEW clientSaleId, only after a confirmed success
      usePosUi.getState().setPayOpen(false);
      void qc.invalidateQueries({ queryKey: ['pos-search', branch.code] }); // on-hand numbers changed
      void qc.invalidateQueries({ queryKey: ['inventory', branch.code] });
      void qc.invalidateQueries({ queryKey: ['sales', branch.code] }); // history
      void qc.invalidateQueries({ queryKey: qk.shift(branch.code) }); // the POS shift card
      navigate(`/b/${branch.code}/sales/${sale.id}/print?from=pos`, { state: { sale } });
    },
    onError: (err) => {
      if (!(err instanceof ApiError) || isUncertain(err)) return; // the dialog shows "Retry is safe"
      const ui = usePosUi.getState();
      const cart = useCart.getState();
      if (err.code === 'INSUFFICIENT_STOCK') {
        const d = err.details as { productId: string; available: number }[];
        cart.markProblems(
          Object.fromEntries(d.map((x) => [x.productId, `Only ${x.available} left at ${branch.code}`])),
        );
        ui.setPayOpen(false);
        toast.error('Not enough stock for some items: check the red lines.');
      } else if (err.code === 'PRICE_CHANGED') {
        const fresh = (err.details as { cart: PricedCart }).cart;
        cart.applyPrices(Object.fromEntries(fresh.lines.map((l) => [l.productId, l.unitPrice])));
        toast.warning(
          `Prices changed. New total ${formatMoney(fresh.total, settings.currency)}. Check and pay again.`,
        );
      } else if (err.code === 'PRODUCT_INACTIVE') {
        const d = err.details as { productId: string }[];
        cart.markProblems(Object.fromEntries(d.map((x) => [x.productId, 'No longer sold: remove it'])));
        ui.setPayOpen(false);
      } else {
        toast.error(err.message); // DISCOUNT_LIMIT, PAYMENT_INVALID, BRANCH_INACTIVE…
      }
    },
  });

  return {
    ...mutation,
    isUncertain: isUncertain(mutation.error),
    retry: () => lastArgs.current && mutation.mutate(lastArgs.current),
  };
}
