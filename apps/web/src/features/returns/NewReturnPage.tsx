import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  daysBetween,
  PAYMENT_METHODS,
  RETURN_REASONS,
  refundPart,
  toBusinessDate,
  type PaymentMethod,
  type ReturnDto,
  type ReturnReason,
  type SaleDto,
} from '@shopstock/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { isUncertain } from '@/features/pos/useCompleteSale';
import { METHOD_LABEL, toInvoiceNo, useSale } from '@/features/sales/hooks';
import { useFormat } from '@/lib/useFormat';
import { REASON_LABEL, WRITE_OFF_REASONS } from './hooks';

const select = 'h-9 rounded-md border bg-transparent px-3 text-sm';

/**
 * /b/:code/returns/new?sale=<saleId> (FR-RET-01..12). Without ?sale it asks for the invoice number.
 * The form is keyed on the sale, so looking up another invoice starts a fresh clientReturnId.
 */
export function NewReturnPage() {
  const branch = useBranch();
  const [params, setParams] = useSearchParams();
  const saleId = params.get('sale') ?? '';
  const sale = useSale(branch.code, saleId);

  if (!saleId) return <FindSale onFound={(id) => setParams({ sale: id }, { replace: true })} />;
  if (sale.isError) {
    return (
      <div className="space-y-3">
        <p>Sale not found.</p>
        <Button variant="outline" onClick={() => setParams({}, { replace: true })}>
          Look up another invoice
        </Button>
      </div>
    );
  }
  if (!sale.data) return <Skeleton className="h-96 w-full" />;
  return <ReturnForm key={sale.data.id} sale={sale.data} refetch={() => void sale.refetch()} />;
}

/** "124" → GUL-000124 → this sale. */
function FindSale({ onFound }: { onFound: (saleId: string) => void }) {
  const branch = useBranch();
  const [invoice, setInvoice] = useState('');
  const find = async () => {
    const no = toInvoiceNo(branch.code, invoice);
    if (!no) return;
    try {
      const { sale } = await http.get<{ sale: SaleDto }>(
        `/b/${branch.code}/sales/by-invoice/${encodeURIComponent(no)}`,
      );
      onFound(sale.id);
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 404 ? `No sale ${no} here.` : (e as Error).message);
    }
  };
  return (
    <div className="max-w-md space-y-3">
      <h1 className="text-xl font-semibold">New return · {branch.code}</h1>
      <p className="text-sm text-gray-600">
        Find the sale by its invoice number (on the customer&apos;s receipt).
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <Input
          autoFocus
          aria-label="Invoice number"
          className="font-mono"
          placeholder={`${branch.code}-000124 or 124`}
          value={invoice}
          onChange={(e) => setInvoice(e.target.value)}
        />
        <Button type="submit">Find sale</Button>
      </form>
    </div>
  );
}

function ReturnForm({ sale, refetch }: { sale: SaleDto; refetch: () => void }) {
  const branch = useBranch();
  const { settings } = useActor();
  const { money, dateTime } = useFormat();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Idempotency: one key per screen, reused by Retry. A success navigates away, so it's never reused.
  const clientReturnId = useRef(crypto.randomUUID());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState<ReturnReason>('changed_mind');
  const [note, setNote] = useState('');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>(sale.payments[0]!.method);
  const [serverExpired, setServerExpired] = useState(false);

  const today = toBusinessDate(new Date(), settings.timezone);
  const daysOld = daysBetween(sale.businessDate, today);
  const expired = serverExpired || daysOld > settings.returnWindowDays;

  // Max per line comes from the sale DTO; refetching after a lost race shrinks it, and q follows.
  const lines = sale.items.map((l) => {
    const max = l.qty - l.returnedQty;
    const q = Math.min(qty[l.id] ?? 0, max);
    return {
      line: l,
      max,
      q,
      restock: restock[l.id] ?? !WRITE_OFF_REASONS.has(reason),
      // The SAME function the server uses: un-raced, the preview is exactly the refund.
      refund: q > 0 ? refundPart(l.total, l.qty, l.returnedQty, q) : 0,
    };
  });
  const chosen = lines.filter((x) => x.q > 0);
  const refundTotal = chosen.reduce((s, x) => s + x.refund, 0);
  const nothingLeft = lines.every((x) => x.max === 0);
  const noteMissing = reason === 'other' && !note.trim();

  const mutation = useMutation({
    retry: false, // retrying is the manager's decision, with the SAME clientReturnId
    mutationFn: () =>
      http.post<{ return: ReturnDto; replayed: boolean }>(`/b/${branch.code}/returns`, {
        clientReturnId: clientReturnId.current,
        saleId: sale.id,
        lines: chosen.map((x) => ({ saleLineId: x.line.id, qty: x.q, restock: x.restock })),
        reason,
        note: note.trim(),
        refundMethod,
      }),
    onSuccess: ({ return: r, replayed }) => {
      const msg = `${r.returnNo}: refund ${money(r.refund.amount)} in ${METHOD_LABEL[r.refund.method].toLowerCase()}`;
      if (replayed) toast.info(`${msg} (already recorded, not refunded twice)`);
      else toast.success(msg);
      void qc.invalidateQueries({ queryKey: qk.sale(branch.code, sale.id) });
      void qc.invalidateQueries({ queryKey: ['sales', branch.code] }); // return status in the history
      void qc.invalidateQueries({ queryKey: ['returns', branch.code] });
      void qc.invalidateQueries({ queryKey: ['inventory', branch.code] }); // restocked quantities
      void qc.invalidateQueries({ queryKey: ['inventory-row', branch.code] });
      void qc.invalidateQueries({ queryKey: ['movements', branch.code] });
      void qc.invalidateQueries({ queryKey: ['pos-search', branch.code] });
      void qc.invalidateQueries({ queryKey: ['dashboard', branch.code] }); // this tab's own action shows at once
      void qc.invalidateQueries({ queryKey: ['low-stock', branch.code] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
      navigate(`/b/${branch.code}/returns/${r.id}`, { state: { ret: r } });
    },
    onError: (err) => {
      if (!(err instanceof ApiError) || isUncertain(err)) return; // the alert below offers a safe Retry
      if (err.code === 'RETURN_EXCEEDS_SOLD') {
        refetch(); // the new maximums arrive with the sale
        toast.error(`Someone returned items from this sale a moment ago. ${err.message}`);
      } else if (err.code === 'RETURN_WINDOW_EXPIRED') {
        setServerExpired(true);
      } else {
        toast.error(err.message);
      }
    },
  });

  const changeReason = (r: ReturnReason) => {
    setReason(r);
    setRestock({}); // back to the reason's default (damaged/expired: written off)
  };

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">
          Return against <span className="font-mono">{sale.invoiceNo}</span>
        </h1>
        <p className="text-sm text-gray-600">
          {dateTime(sale.createdAt)} · {sale.cashierName} · window: {settings.returnWindowDays} days,{' '}
          {daysOld === 0 ? 'sold today' : `${daysOld} day${daysOld === 1 ? '' : 's'} old`}
        </p>
      </div>

      {expired && (
        <Alert variant="destructive">
          <AlertTitle>The return window has passed</AlertTitle>
          <AlertDescription>
            Returns are accepted within {settings.returnWindowDays} days of the sale. This one is {daysOld}{' '}
            days old.
          </AlertDescription>
        </Alert>
      )}
      {nothingLeft && !expired && (
        <Alert>
          <AlertTitle>Everything on this sale has already been returned</AlertTitle>
        </Alert>
      )}

      <fieldset disabled={expired || nothingLeft || mutation.isPending} className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Sold</TableHead>
              <TableHead className="text-right">Returned</TableHead>
              <TableHead className="w-36">Return now</TableHead>
              <TableHead>Restock?</TableHead>
              <TableHead className="text-right">Refund</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map(({ line: l, max, q, restock: rs, refund }) => (
              <TableRow key={l.id} className={max === 0 ? 'text-gray-500' : undefined}>
                <TableCell>
                  {l.name} <span className="font-mono text-xs text-gray-500">{l.sku}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{l.returnedQty}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      aria-label={`Return quantity for ${l.name}`}
                      className="h-8 w-20 text-right tabular-nums"
                      min={0}
                      max={max}
                      value={q}
                      disabled={max === 0}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(max, Math.trunc(Number(e.target.value) || 0)));
                        setQty((s) => ({ ...s, [l.id]: v }));
                      }}
                    />
                    {max > 0 && max < l.qty && <span className="text-xs text-gray-500">max {max}</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      aria-label={`Restock ${l.name}`}
                      checked={rs}
                      disabled={max === 0}
                      onChange={(e) => setRestock((s) => ({ ...s, [l.id]: e.target.checked }))}
                    />
                    {q > 0 && !rs && <span className="text-xs text-red-700">write off</span>}
                  </label>
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(refund)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="block text-gray-600">Reason</span>
            <select
              className={select}
              value={reason}
              onChange={(e) => changeReason(e.target.value as ReturnReason)}
            >
              {RETURN_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-64 flex-1 space-y-1 text-sm">
            <span className="block text-gray-600">Note{reason === 'other' && ' (required)'}</span>
            <Input
              maxLength={500}
              value={note}
              aria-invalid={noteMissing && chosen.length > 0}
              onChange={(e) => setNote(e.target.value)}
              placeholder={reason === 'other' ? 'Explain the reason' : 'Optional'}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-gray-600">Refund via</span>
            <select
              className={select}
              value={refundMethod}
              onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      {mutation.isError && isUncertain(mutation.error) && (
        <Alert variant="destructive">
          <AlertTitle>We couldn&apos;t confirm the return</AlertTitle>
          <AlertDescription>
            The connection dropped before the server answered. Retry is safe: the same return can&apos;t be
            recorded twice.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-end gap-4 border-t pt-4">
        <span className="text-sm text-gray-600">Refund total</span>
        <span className="text-xl font-semibold tabular-nums">{money(refundTotal)}</span>
        <Button variant="ghost" asChild>
          <Link to={`/b/${branch.code}/sales/${sale.id}`}>Cancel</Link>
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={expired || chosen.length === 0 || noteMissing || mutation.isPending}
        >
          {mutation.isPending
            ? 'Saving…'
            : mutation.isError && isUncertain(mutation.error)
              ? 'Retry'
              : 'Confirm return'}
        </Button>
      </div>
    </div>
  );
}
