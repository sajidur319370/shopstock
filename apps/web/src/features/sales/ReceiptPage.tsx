import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SaleDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { cn } from '@/lib/utils';
import { useBranchDetails, useSale } from './hooks';
import { Receipt80 } from './Receipt80';
import { ReceiptA4 } from './ReceiptA4';

type Format = '80mm' | 'a4';

/**
 * /b/:code/sales/:saleId/print (FR-IVC-01): the receipt, rendered from the STORED sale.
 * From the POS (?from=pos) it prints once by itself, then goes back to a fresh cart.
 */
export function ReceiptPage() {
  const branch = useBranch();
  const { saleId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { settings } = useActor();
  const fromPos = params.get('from') === 'pos';
  const pos = `/b/${branch.code}/pos`;
  const [format, setFormat] = useState<Format>(settings.receiptFormat);
  const [copy, setCopy] = useState(false);

  const stateSale = (useLocation().state as { sale?: SaleDto } | null)?.sale;
  const sale = useSale(branch.code, saleId, stateSale?.id === saleId ? stateSale : undefined);
  const details = useBranchDetails(branch.code);
  const ready = !!sale.data && !!details.data;

  const printNow = useCallback(async () => {
    try {
      // Count FIRST (atomic $inc): the answer decides whether this print says COPY (FR-IVC-04).
      const res = await http.post<{ copy: boolean }>(`/b/${branch.code}/sales/${saleId}/printed`);
      flushSync(() => setCopy(res.copy)); // "COPY" must be on the page BEFORE the print dialog snapshots it
      window.print();
      void qc.invalidateQueries({ queryKey: qk.sale(branch.code, saleId) }); // printCount changed
    } catch (e) {
      toast.error(`Couldn't print: ${(e as Error).message}`);
    }
  }, [branch.code, saleId, qc]);

  // Coming from the POS: print automatically ONCE (the ref survives StrictMode's double effect run;
  // a second auto-print would turn the customer's original into a COPY).
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (!ready || !fromPos || autoPrinted.current) return;
    autoPrinted.current = true;
    void printNow();
  }, [ready, fromPos, printNow]);

  // …and when the print dialog closes (printed or cancelled), straight back to a new sale.
  useEffect(() => {
    if (!fromPos) return;
    const back = () => navigate(pos, { replace: true });
    window.addEventListener('afterprint', back);
    return () => window.removeEventListener('afterprint', back);
  }, [fromPos, navigate, pos]);

  // Enter = "New sale" (React's autoFocus doesn't work on links).
  const next = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (ready) next.current?.focus();
  }, [ready]);

  if (sale.isError) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <p>Sale not found.</p>
        <Button variant="outline" asChild>
          <Link to={`/b/${branch.code}/sales`}>Sales history</Link>
        </Button>
      </div>
    );
  }
  if (!sale.data || !details.data) return <Skeleton className="mx-auto h-96 w-[80mm]" />;

  const props = { sale: sale.data, branch: details.data, settings, copy };
  return (
    <div className="space-y-4">
      {/* Rendered from STATE, so switching the format switches the paper size too. */}
      <style>
        {format === '80mm' ? '@page { size: 80mm auto; margin: 0 }' : '@page { size: A4; margin: 12mm }'}
      </style>
      <div className="flex flex-wrap items-center justify-center gap-2 print:hidden">
        <Button onClick={() => void printNow()}>
          {sale.data.printCount > 0 ? 'Reprint (COPY)' : 'Print'}
        </Button>
        <div role="group" aria-label="Paper" className="flex overflow-hidden rounded-md border">
          {(['80mm', 'a4'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={format === f}
              onClick={() => setFormat(f)}
              className={cn('px-3 py-1.5 text-sm', format === f && 'bg-gray-900 text-white')}
            >
              {f === '80mm' ? '80 mm' : 'A4'}
            </button>
          ))}
        </div>
        {fromPos ? (
          <Button asChild variant="outline">
            <Link ref={next} to={pos} replace>
              New sale (Enter)
            </Link>
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link ref={next} to={`/b/${branch.code}/sales/${saleId}`}>
              Back to sale
            </Link>
          </Button>
        )}
      </div>
      {format === '80mm' ? <Receipt80 {...props} /> : <ReceiptA4 {...props} />}
    </div>
  );
}
