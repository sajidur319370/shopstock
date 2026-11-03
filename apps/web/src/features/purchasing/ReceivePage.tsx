import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { PO_OPEN_STATUSES, type PODto } from '@shopstock/shared';
import { ApiError, http } from '@/api/client';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MoneyInput } from '@/components/MoneyInput';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBranch } from '@/features/branch/useBranch';
import { isUncertain } from '@/features/pos/useCompleteSale';
import { useFormat } from '@/lib/useFormat';
import { PO_STATUS_LABEL, poPath, usePO, usePOMutation } from './hooks';

const isOpen = (s: string) => (PO_OPEN_STATUSES as readonly string[]).includes(s);

/**
 * /b/:code/purchase-orders/:id/receive (FR-PO-05). ONE clientReceiptId per screen = one per delivery:
 * a double click or a Retry after a network error sends the same key, and the server applies the
 * receipt once (AC-PO-02). A new delivery opens a new screen, so it gets a new key.
 */
export function ReceivePage() {
  const branch = useBranch();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { money } = useFormat();
  const po = usePO(id);
  const [clientReceiptId] = useState(() => crypto.randomUUID()); // created once, when the screen opens
  // Typed quantities only; an untouched line means "everything still expected" (pre-filled).
  const [qty, setQty] = useState<Record<string, number>>({});
  const [overrideCosts, setOverrideCosts] = useState(false);
  const [costs, setCosts] = useState<Record<string, number | null>>({});
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [banner, setBanner] = useState<'raced' | 'state' | null>(null);

  const receive = usePOMutation(id, (lines: { productId: string; qty: number; unitCost?: number }[]) =>
    http.post<{ purchaseOrder: PODto; replayed: boolean }>(`${poPath(branch.code, id)}/receive`, {
      clientReceiptId,
      note: note.trim(),
      lines,
    }),
  );

  if (po.isError) return <p className="text-red-600">Purchase order not found.</p>;
  if (!po.data) return <Skeleton className="h-96 w-full" />;
  const p = po.data;
  const detail = poPath(branch.code, p.id);
  // Not receivable when the screen OPENS: back to the detail. (A change while open shows a banner instead.)
  if (!isOpen(p.status) && !banner && !receive.isSuccess) return <Navigate to={detail} replace />;

  // Clamped to what's left NOW: after a refetch (someone else received), the inputs follow by themselves.
  const lines = p.items.map((i) => {
    const q = Math.min(qty[i.productId] ?? i.remaining, i.remaining);
    const override = overrideCosts ? (costs[i.productId] ?? null) : null;
    return { item: i, q, override, cost: override ?? i.unitCost };
  });
  const sending = lines.filter((l) => l.q > 0);
  const units = sending.reduce((s, l) => s + l.q, 0);
  const value = sending.reduce((s, l) => s + l.q * l.cost, 0);
  const summary = `${sending.length} line${sending.length === 1 ? '' : 's'}, ${units} unit${units === 1 ? '' : 's'}, ${money(value)} into ${branch.code} stock`;
  const uncertain = receive.isError && isUncertain(receive.error);

  const submit = () =>
    receive.mutate(
      sending.map((l) => ({
        productId: l.item.productId,
        qty: l.q,
        ...(l.override !== null && { unitCost: l.override }), // empty = the PO line cost
      })),
      {
        onSuccess: (r) => {
          setConfirming(false);
          if (r.replayed) toast.info('This delivery was already recorded. Nothing was added twice.');
          else
            toast.success(
              `Received. ${r.purchaseOrder.poNumber} is now ${PO_STATUS_LABEL[r.purchaseOrder.status].toLowerCase()}.`,
            );
          navigate(detail);
        },
        onError: (err) => {
          setConfirming(false);
          if (!(err instanceof ApiError) || isUncertain(err)) return; // the Retry alert below
          if (err.code === 'RECEIVE_EXCEEDS_ORDERED') {
            setBanner('raced'); // nothing was applied: the key stays, the inputs re-clamp after the refetch
            void po.refetch();
          } else if (err.code === 'INVALID_STATE') {
            setBanner('state');
            void po.refetch();
          } else {
            toast.error(err.message);
          }
        },
      },
    );

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">
          Receive delivery · <span className="font-mono">{p.poNumber}</span>
        </h1>
        <p className="text-sm text-gray-600">
          {p.supplierName} · {PO_STATUS_LABEL[p.status]}
        </p>
      </div>

      {banner === 'raced' && (
        <Alert>
          <AlertTitle>Someone received part of this purchase order a moment ago</AlertTitle>
          <AlertDescription>
            Nothing from your screen was recorded. The quantities now show what is still expected: check them
            against the delivery and confirm again.
          </AlertDescription>
        </Alert>
      )}
      {banner === 'state' && (
        <Alert variant="destructive">
          <AlertTitle>This purchase order can&apos;t take this delivery</AlertTitle>
          <AlertDescription>
            {isOpen(p.status)
              ? 'It already has the maximum of 20 deliveries.'
              : `It is ${PO_STATUS_LABEL[p.status].toLowerCase()} now.`}{' '}
            <Link className="underline" to={detail}>
              Back to {p.poNumber}
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <fieldset disabled={banner === 'state' || receive.isPending} className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead className="w-32">Receiving now</TableHead>
              {overrideCosts && <TableHead className="w-44">Invoice unit cost</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map(({ item: i, q, override }) => (
              <TableRow key={i.productId} className={i.remaining === 0 ? 'text-gray-500' : undefined}>
                <TableCell>
                  {i.name} <span className="font-mono text-xs text-gray-500">{i.sku}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{i.orderedQty}</TableCell>
                <TableCell className="text-right tabular-nums">{i.remaining}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={i.remaining}
                    aria-label={`Receiving now: ${i.name}`}
                    className="h-8 text-right tabular-nums"
                    value={q}
                    disabled={i.remaining === 0}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(i.remaining, Math.trunc(Number(e.target.value) || 0)));
                      setQty((s) => ({ ...s, [i.productId]: v }));
                    }}
                  />
                </TableCell>
                {overrideCosts && (
                  <TableCell>
                    <MoneyInput
                      placeholder={money(i.unitCost).replace(/[^\d.,]/g, '')}
                      value={override}
                      onChange={(v) => setCosts((s) => ({ ...s, [i.productId]: v }))}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={overrideCosts}
            onChange={(e) => setOverrideCosts(e.target.checked)}
          />
          Different price on the invoice? (empty = the PO cost)
        </label>
        <label className="block max-w-xl space-y-1 text-sm">
          <span className="text-gray-600">Note (optional)</span>
          <Input
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Truck 1, invoice #…"
          />
        </label>
      </fieldset>

      {uncertain && (
        <Alert variant="destructive">
          <AlertTitle>We couldn&apos;t confirm the delivery was recorded</AlertTitle>
          <AlertDescription>
            The connection dropped before the server answered. Retry is safe: the same delivery can&apos;t be
            added twice.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        <span className="text-sm text-gray-600">{sending.length > 0 ? summary : 'Nothing to receive'}</span>
        <Button variant="ghost" asChild>
          <Link to={detail}>Cancel</Link>
        </Button>
        {uncertain ? (
          <Button onClick={submit} disabled={receive.isPending}>
            {receive.isPending ? 'Retrying…' : 'Retry'}
          </Button>
        ) : (
          <Button
            onClick={() => setConfirming(true)}
            disabled={sending.length === 0 || banner === 'state' || receive.isPending}
          >
            Confirm receipt
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Receive into ${branch.code}?`}
        description={`${summary}. Stock and average costs update immediately.`}
        confirmLabel="Receive"
        pending={receive.isPending}
        onConfirm={submit}
      />
    </div>
  );
}
