import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PODto } from '@shopstock/shared';
import { ApiError, http } from '@/api/client';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { useFormat } from '@/lib/useFormat';
import { poPath, usePO, usePOMutation } from './hooks';
import { poActions, type POAction } from './poActions';
import { POStatusBadge } from './POStatusBadge';

type Transition = 'order' | 'cancel' | 'close';
type Confirmable = Transition | 'delete';
const DONE: Record<Transition, string> = { order: 'ordered', cancel: 'cancelled', close: 'closed' };

/** What each irreversible action will change, in the user's words (NFR-UX-02). */
function confirmText(po: PODto, a: Confirmable) {
  const left = po.items.filter((i) => i.remaining > 0).map((i) => `${i.remaining} × ${i.name}`);
  return {
    order: {
      title: `Mark ${po.poNumber} as ordered?`,
      body: "Lines can't be edited afterwards.",
      label: 'Mark as ordered',
    },
    cancel: { title: `Cancel ${po.poNumber}?`, body: "This can't be undone.", label: 'Cancel PO' },
    close: {
      title: `Close ${po.poNumber}?`,
      body: `${left.join(', ')} will no longer be expected. This can't be undone.`,
      label: 'Close PO',
    },
    delete: {
      title: 'Delete this draft permanently?',
      body: `${po.poNumber} will be removed.`,
      label: 'Delete',
    },
  }[a];
}

/** /b/:code/purchase-orders/:id (FR-PO-10). The buttons come from poActions(po, can) and nowhere else. */
export function PODetailPage() {
  const branch = useBranch();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useActor();
  const { money, dateTime } = useFormat();
  const po = usePO(id);
  const [confirm, setConfirm] = useState<Confirmable | null>(null);

  // Someone else acted first (409 INVALID_STATE): say so, refetch, and the buttons update by themselves.
  const onConflict = (err: unknown) => {
    toast.error(err instanceof ApiError ? err.message : (err as Error).message);
    setConfirm(null);
    void po.refetch();
  };
  const transition = usePOMutation(id, (a: Transition) =>
    http.post<{ purchaseOrder: PODto }>(`${poPath(branch.code, id)}/${a}`),
  );
  const del = useMutation({
    mutationFn: () => http.delete<void>(poPath(branch.code, id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos', branch.code] });
      toast.success('Draft deleted');
      navigate(poPath(branch.code), { replace: true });
    },
    onError: onConflict,
  });

  if (po.isError) {
    return (
      <div className="space-y-3">
        <p>Purchase order not found.</p>
        <Button variant="outline" asChild>
          <Link to={poPath(branch.code)}>Back to purchase orders</Link>
        </Button>
      </div>
    );
  }
  if (!po.data) return <Skeleton className="h-96 w-full" />;
  const p = po.data;
  const actions = poActions(p, can);
  const has = (a: POAction) => actions.includes(a);
  const run = (a: Confirmable) =>
    a === 'delete'
      ? del.mutate()
      : transition.mutate(a, {
          onSuccess: ({ purchaseOrder }) => {
            setConfirm(null);
            toast.success(`${purchaseOrder.poNumber}: ${DONE[a]}`);
          },
          onError: onConflict,
        });
  const receipts = [...p.receipts].reverse(); // newest first
  const nameOf = new Map(p.items.map((i) => [i.productId, i.name]));
  const text = confirm && confirmText(p, confirm);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            <span className="font-mono">{p.poNumber}</span> ·
            <Link className="underline" to={`/suppliers/${p.supplierId}`}>
              {p.supplierName}
            </Link>
            <POStatusBadge status={p.status} />
          </h1>
          <p className="text-sm text-gray-600">
            Created {dateTime(p.createdAt)}
            {p.orderedAt && ` · Ordered ${dateTime(p.orderedAt)}`}
            {p.expectedDate && ` · Expected ${p.expectedDate}`}
            {p.completedAt && ` · Received ${dateTime(p.completedAt)}`}
            {p.cancelledAt && ` · Cancelled ${dateTime(p.cancelledAt)}`}
            {p.closedAt && ` · Closed ${dateTime(p.closedAt)}`}
          </p>
          {p.notes && <p className="text-sm whitespace-pre-line text-gray-600">Notes: {p.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {has('receive') && (
            <Button asChild>
              <Link to={`${poPath(branch.code, p.id)}/receive`}>Receive delivery</Link>
            </Button>
          )}
          {has('order') && <Button onClick={() => setConfirm('order')}>Mark as ordered</Button>}
          {has('edit') && (
            <Button variant="outline" asChild>
              <Link to={`${poPath(branch.code, p.id)}/edit`}>Edit</Link>
            </Button>
          )}
          {has('close') && (
            <Button variant="outline" onClick={() => setConfirm('close')}>
              Close (rest won&apos;t come)
            </Button>
          )}
          {has('cancel') && (
            <Button variant="outline" onClick={() => setConfirm('cancel')}>
              Cancel PO
            </Button>
          )}
          {has('delete') && (
            <Button variant="ghost" onClick={() => setConfirm('delete')}>
              Delete draft
            </Button>
          )}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Ordered</TableHead>
            <TableHead className="text-right">Received</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead className="text-right">Unit cost</TableHead>
            <TableHead className="text-right">Ordered value</TableHead>
            <TableHead className="w-32" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {p.items.map((i) => (
            <TableRow key={i.productId}>
              <TableCell>
                {i.name} <span className="font-mono text-xs text-gray-500">{i.sku}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{i.orderedQty}</TableCell>
              <TableCell className="text-right tabular-nums">{i.receivedQty}</TableCell>
              <TableCell className="text-right tabular-nums">{i.remaining}</TableCell>
              <TableCell className="text-right tabular-nums">{money(i.unitCost)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(i.orderedQty * i.unitCost)}</TableCell>
              <TableCell>
                <Progress
                  value={(i.receivedQty / i.orderedQty) * 100}
                  aria-label={`${i.receivedQty} of ${i.orderedQty} received`}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-right text-sm tabular-nums">
        Ordered <span className="font-medium">{money(p.totals.orderedValue)}</span> · Received{' '}
        <span className="font-medium">{money(p.totals.receivedValue)}</span>
      </p>

      <section className="space-y-2">
        <h2 className="font-medium">Receipts</h2>
        {receipts.length === 0 && <p className="text-sm text-gray-500">Nothing received yet.</p>}
        <ul className="space-y-1 text-sm">
          {receipts.map((r) => (
            <li key={r.id}>
              <details className="rounded-md border px-3 py-2">
                <summary className="cursor-pointer tabular-nums">
                  {dateTime(r.receivedAt)} · {r.receivedByName} · {r.lines.length} line
                  {r.lines.length === 1 ? '' : 's'} ·{' '}
                  {money(r.lines.reduce((s, l) => s + l.qty * l.unitCost, 0))}
                  {r.note && <span className="text-gray-600"> · “{r.note}”</span>}
                </summary>
                <ul className="mt-1 space-y-0.5 pl-4 text-gray-700">
                  {r.lines.map((l) => (
                    // the RECEIPT's cost: it differs from the PO line cost when the invoice price did
                    <li key={l.productId} className="tabular-nums">
                      {nameOf.get(l.productId) ?? l.productId} {l.qty} @ {money(l.unitCost)}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </section>

      {confirm && text && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={text.title}
          description={text.body}
          confirmLabel={text.label}
          destructive={confirm !== 'order'}
          pending={transition.isPending || del.isPending}
          onConfirm={() => run(confirm)}
        />
      )}
    </div>
  );
}
