import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { toast } from 'sonner';
import type { TransferDto } from '@shopstock/shared';
import { ApiError } from '@/api/client';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { useFormat } from '@/lib/useFormat';
import { cn } from '@/lib/utils';
import { transferPath, useTransfer, useTransferAction } from './hooks';
import type { DispatchLineErrors } from './NewTransferPage';
import { transferActions, transferWaiting, type TransferAction } from './transferActions';
import { TransferStatusBadge } from './TransferStatusBadge';

const listOf = (t: TransferDto) => t.items.map((i) => `${i.qty} × ${i.name}`).join(', ');

/** What each irreversible action will change (NFR-UX-02). */
const confirmText = (t: TransferDto, a: TransferAction) =>
  ({
    dispatch: {
      title: `Dispatch ${t.transferNo}?`,
      body: `Take ${listOf(t)} out of ${t.fromCode} stock now? It will show as in transit until ${t.toCode} receives it.`,
      label: 'Dispatch',
    },
    receive: {
      title: `Receive ${t.transferNo}?`,
      body: `Add ${listOf(t)} to ${t.toCode} stock?`,
      label: 'Receive',
    },
    cancel: {
      title: `Cancel ${t.transferNo}?`,
      body: `Nothing has left ${t.fromCode} yet. This can't be undone.`,
      label: 'Cancel transfer',
    },
  })[a];

const DONE: Record<TransferAction, (t: TransferDto) => string> = {
  dispatch: (t) => `${t.transferNo} is on its way to ${t.toCode}.`,
  receive: (t) => `${t.totals.units} units added to ${t.toCode} stock.`,
  cancel: (t) => `${t.transferNo} cancelled.`,
};

/** /b/:code/transfers/:id: either side may open it; the buttons are only this side's (transferActions). */
export function TransferDetailPage() {
  const branch = useBranch();
  const { id = '' } = useParams();
  const { can } = useActor();
  const { money, dateTime } = useFormat();
  const transfer = useTransfer(id);
  const act = useTransferAction();
  const [confirm, setConfirm] = useState<TransferAction | null>(null);
  // From "Save and dispatch" with a short line, or from a failed Dispatch here: messages per product.
  const carried = (useLocation().state as { lineErrors?: DispatchLineErrors } | null)?.lineErrors ?? {};
  const [lineErrors, setLineErrors] = useState<DispatchLineErrors>(carried);

  if (transfer.isError) {
    return (
      <div className="space-y-3">
        <p>Transfer not found.</p>
        <Button variant="outline" asChild>
          <Link to={transferPath(branch.code)}>Back to transfers</Link>
        </Button>
      </div>
    );
  }
  if (!transfer.data) return <Skeleton className="h-96 w-full" />;
  const t = transfer.data;
  const actions = transferActions(t, branch.code, can);
  const waiting = transferWaiting(t, branch.code);
  const showCost = t.totals.value !== undefined; // the DTO decides

  const run = (a: TransferAction) =>
    act.mutate(
      { id: t.id, action: a },
      {
        onSuccess: (fresh) => {
          setConfirm(null);
          setLineErrors({});
          toast.success(DONE[a](fresh));
        },
        onError: (err) => {
          setConfirm(null);
          if (err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK' && Array.isArray(err.details)) {
            setLineErrors(
              Object.fromEntries(
                (err.details as { productId: string; available: number }[]).map((d) => [
                  d.productId,
                  `Only ${d.available} in stock`,
                ]),
              ),
            );
            toast.error('Not enough stock for some lines: nothing left the branch.');
          } else {
            toast.error((err as Error).message); // INVALID_STATE: someone else acted first
          }
          void transfer.refetch(); // the buttons follow the fresh status
        },
      },
    );

  const steps = [
    { label: 'Created', at: t.createdAt, by: t.createdByName, where: t.fromCode },
    t.status === 'cancelled'
      ? { label: 'Cancelled', at: t.cancelledAt, by: t.cancelledByName, where: t.fromCode }
      : { label: 'Dispatched', at: t.dispatchedAt, by: t.dispatchedByName, where: t.fromCode },
    ...(t.status === 'cancelled'
      ? []
      : [{ label: 'Received', at: t.receivedAt, by: t.receivedByName, where: t.toCode }]),
  ];
  const text = confirm && confirmText(t, confirm);

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
          <span className="font-mono">{t.transferNo}</span> ·
          <span className="font-mono">
            {t.fromCode} → {t.toCode}
          </span>
          <TransferStatusBadge status={t.status} />
        </h1>
        <Button variant="ghost" asChild>
          <Link to={transferPath(branch.code)}>Back</Link>
        </Button>
      </div>

      <ol className="space-y-1 text-sm" aria-label="Timeline">
        {steps.map((s) => (
          <li key={s.label} className={cn('flex flex-wrap gap-x-3', !s.at && 'text-gray-500')}>
            <span aria-hidden className="w-4">
              {s.at ? '✓' : '○'}
            </span>
            <span className="w-24 font-medium">{s.label}</span>
            <span className="tabular-nums">{s.at ? dateTime(s.at) : '—'}</span>
            {s.at && (
              <span>
                {s.by} ({s.where})
              </span>
            )}
            {!s.at && s.label === 'Received' && t.status === 'in_transit' && (
              <span>waiting for {t.toCode}</span>
            )}
          </li>
        ))}
      </ol>
      {t.note && <p className="text-sm whitespace-pre-line text-gray-600">Note: {t.note}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            {showCost && <TableHead className="text-right">Unit cost</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {t.items.map((i) => (
            <TableRow key={i.productId}>
              <TableCell>
                {i.name} <span className="font-mono text-xs text-gray-500">{i.sku}</span>
                {lineErrors[i.productId] && <p className="text-xs text-red-600">{lineErrors[i.productId]}</p>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{i.qty}</TableCell>
              {showCost && (
                <TableCell className="text-right tabular-nums">
                  {i.unitCost == null ? (
                    <span className="text-gray-500" title="Set when the goods leave">
                      at dispatch
                    </span>
                  ) : (
                    money(i.unitCost)
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-right text-sm tabular-nums">
        {t.totals.units} unit{t.totals.units === 1 ? '' : 's'}
        {showCost && t.totals.value != null && (
          <> · value {money(t.totals.value)} (at the cost it left with)</>
        )}
      </p>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        <span className="text-xs text-gray-500">(viewed at {branch.code})</span>
        {waiting && <span className="text-sm text-gray-600">{waiting}</span>}
        {actions.includes('receive') && (
          <Button onClick={() => setConfirm('receive')}>
            Receive {t.totals.units} units into {t.toCode}
          </Button>
        )}
        {actions.includes('dispatch') && <Button onClick={() => setConfirm('dispatch')}>Dispatch</Button>}
        {actions.includes('cancel') && (
          <Button variant="outline" onClick={() => setConfirm('cancel')}>
            Cancel transfer
          </Button>
        )}
      </div>

      {confirm && text && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={text.title}
          description={text.body}
          confirmLabel={text.label}
          destructive={confirm === 'cancel'}
          pending={act.isPending}
          onConfirm={() => run(confirm)}
        />
      )}
    </div>
  );
}
