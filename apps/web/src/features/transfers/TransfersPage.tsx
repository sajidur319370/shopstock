import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TRANSFER_STATUSES, type Page, type TransferRowDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Can, useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { useFormat } from '@/lib/useFormat';
import { cn } from '@/lib/utils';
import { TRANSFER_STATUS_LABEL, transferPath, useTransferAction } from './hooks';
import { transferActions } from './transferActions';
import { TransferStatusBadge } from './TransferStatusBadge';

const DIRECTIONS = [
  ['all', 'All'],
  ['incoming', 'Incoming'],
  ['outgoing', 'Outgoing'],
] as const;

/** /b/:code/transfers: both halves of this branch's transfers; direction and status live in the URL. */
export function TransfersPage() {
  const branch = useBranch();
  const { can } = useActor();
  const navigate = useNavigate();
  const { dateTime } = useFormat();
  const [params, setParams] = useSearchParams();
  const direction = params.get('direction') ?? 'all';
  const status = params.get('status') ?? '';
  const setParam = (key: string, value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );

  const f = { direction, status };
  const list = useInfiniteQuery({
    queryKey: qk.transfers(branch.code, f),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ direction });
      if (status) sp.set('status', status);
      if (pageParam) sp.set('cursor', pageParam);
      return http.get<Page<TransferRowDto>>(`${transferPath(branch.code)}?${sp}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  // Inline Receive for incoming rows in transit (the detail page offers the same).
  const act = useTransferAction();
  const [receiving, setReceiving] = useState<TransferRowDto | null>(null);
  const receive = (r: TransferRowDto) =>
    act.mutate(
      { id: r.id, action: 'receive' },
      {
        onSuccess: (t) => {
          setReceiving(null);
          toast.success(`${t.transferNo}: ${t.totals.units} units added to ${branch.code} stock`);
        },
        onError: (e) => {
          setReceiving(null);
          toast.error((e as Error).message);
          void list.refetch();
        },
      },
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Transfers · {branch.code}</h1>
        <Can permission="transfer:manage">
          <Button asChild>
            <Link to={`${transferPath(branch.code)}/new`}>New transfer</Link>
          </Button>
        </Can>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Direction" className="flex gap-1">
          {DIRECTIONS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={direction === value}
              onClick={() => setParam('direction', value === 'all' ? '' : value)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm',
                direction === value ? 'border-gray-900 bg-gray-900 text-white' : 'hover:bg-gray-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="Status"
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
          value={status}
          onChange={(e) => setParam('status', e.target.value)}
        >
          <option value="">Any status</option>
          {TRANSFER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TRANSFER_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Number</TableHead>
            <TableHead>From → To</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Lines</TableHead>
            <TableHead className="text-right">Units</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Dispatched</TableHead>
            <TableHead>Received</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.id}
              className="cursor-pointer"
              onClick={() => navigate(transferPath(branch.code, r.id))}
            >
              <TableCell className="font-mono text-xs">{r.transferNo}</TableCell>
              <TableCell className="font-mono whitespace-nowrap">
                {r.fromCode} → {r.toCode}
              </TableCell>
              <TableCell>
                <TransferStatusBadge status={r.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.lineCount}</TableCell>
              <TableCell className="text-right tabular-nums">{r.units}</TableCell>
              <TableCell className="whitespace-nowrap">{dateTime(r.createdAt)}</TableCell>
              <TableCell className="whitespace-nowrap">
                {r.dispatchedAt ? dateTime(r.dispatchedAt) : '—'}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {r.receivedAt ? dateTime(r.receivedAt) : '—'}
              </TableCell>
              <TableCell>
                {transferActions(r, branch.code, can).includes('receive') && (
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation(); // the row itself opens the detail
                      setReceiving(r);
                    }}
                  >
                    Receive
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {!list.isPending && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-gray-500">
                No transfers here.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {list.hasNextPage && (
        <Button variant="outline" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
          {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}

      {receiving && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setReceiving(null)}
          title={`Receive ${receiving.transferNo}?`}
          description={`Add ${receiving.units} unit${receiving.units === 1 ? '' : 's'} from ${receiving.fromCode} to ${branch.code} stock?`}
          confirmLabel="Receive"
          pending={act.isPending}
          onConfirm={() => receive(receiving)}
        />
      )}
    </div>
  );
}
