import { useEffect, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import type { SaleDto } from '@shopstock/shared';
import { Button } from '@/components/ui/button';
import { useFormat } from '@/lib/useFormat';

/**
 * /b/:code/sales/:id/print. Day 13 turns this into the printable receipt (it will load the sale from
 * the API). For now it shows the sale the POS just received, so the cashier can confirm and move on.
 */
export function SaleDonePage() {
  const { branchCode = '' } = useParams();
  const { money } = useFormat();
  const sale = (useLocation().state as { sale?: SaleDto } | null)?.sale;
  const pos = `/b/${branchCode}/pos`;
  const next = useRef<HTMLAnchorElement>(null);
  // React's autoFocus only works on form controls, not links: focus "New sale" so Enter starts one.
  useEffect(() => next.current?.focus(), []);

  if (!sale) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <p>The printable receipt arrives on Day 13.</p>
        <Button asChild>
          <Link ref={next} to={pos}>
            Back to the POS
          </Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md space-y-4 py-12 text-center">
      <p className="text-sm text-gray-500">Sale completed</p>
      <h1 className="font-mono text-2xl font-bold" data-testid="invoice-no">
        {sale.invoiceNo}
      </h1>
      <p className="text-3xl font-bold tabular-nums">{money(sale.totals.total)}</p>
      {sale.change > 0 && (
        <p className="text-xl">
          Change: <b className="tabular-nums">{money(sale.change)}</b>
        </p>
      )}
      <p className="text-sm text-gray-500">
        {sale.payments.map((p) => `${p.method} ${money(p.amount)}`).join(' · ')} · {sale.totals.itemCount}{' '}
        items
      </p>
      <Button asChild className="h-12 w-full text-lg">
        <Link ref={next} to={pos}>
          New sale (Enter)
        </Link>
      </Button>
    </div>
  );
}
