import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  MOVEMENT_TYPES,
  type InventoryRowDto,
  type MovementDto,
  type MovementType,
  type Page,
  type RefType,
} from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { cn } from '@/lib/utils';
import { useFormat } from '@/lib/useFormat';
import { useInvalidateStock } from './hooks';
import { StatusChip } from './StatusChip';

const TYPE_LABEL: Record<MovementType, string> = {
  sale: 'Sale',
  return: 'Return',
  purchase_receipt: 'Purchase receipt',
  transfer_out: 'Transfer out',
  transfer_in: 'Transfer in',
  adjustment: 'Adjustment',
};
const REASON_LABEL: Record<string, string> = {
  opening_balance: 'Opening balance',
  found: 'Found',
  damaged: 'Damaged',
  expired: 'Expired',
  lost: 'Lost',
  count_correction: 'Count correction',
};

/** The page behind each movement (they arrive on later days). Adjustments have no page: a tooltip instead. */
const docHref = (code: string, refType: RefType, refId: string): string | null =>
  ({
    sale: `/b/${code}/sales/${refId}`,
    return: `/b/${code}/returns/${refId}`,
    purchaseOrder: `/b/${code}/purchase-orders/${refId}`,
    transfer: `/b/${code}/transfers/${refId}`,
    adjustment: null,
  })[refType];

type RowResponse = { row: InventoryRowDto; movements?: MovementDto[] };

/** /b/:code/inventory/:productId (Manager+): every movement of one product at this branch. */
export function ProductHistoryPage() {
  const { productId = '' } = useParams();
  const branch = useBranch();
  const { can } = useActor();
  const { money, dateTime } = useFormat();
  const [type, setType] = useState<MovementType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const head = useQuery({
    queryKey: qk.inventoryRow(branch.code, productId),
    queryFn: () => http.get<RowResponse>(`/b/${branch.code}/inventory/${productId}`),
  });
  const filters = { productId, type, from, to };
  const moves = useInfiniteQuery({
    queryKey: qk.movements(branch.code, filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ productId });
      if (type) sp.set('type', type);
      if (from) sp.set('from', from);
      if (to) sp.set('to', to);
      if (pageParam) sp.set('cursor', pageParam);
      return http.get<Page<MovementDto>>(`/b/${branch.code}/movements?${sp}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = moves.data?.pages.flatMap((p) => p.items) ?? [];
  const showCost = items.some((m) => m.unitCost !== undefined);
  const row = head.data?.row;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {row?.name ?? '…'} · {branch.code}
          </h1>
          {row && (
            <p className="flex flex-wrap items-center gap-x-3 text-sm text-gray-600">
              <span>On hand {row.quantity}</span>
              {row.avgCost !== undefined && <span>Avg cost {money(row.avgCost)}</span>}
              <StatusChip status={row.status} />
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {row && can('inventory:configure') && row.status !== 'not_stocked' && (
            <ReorderEditor key={row.reorderLevel} productId={productId} level={row.reorderLevel} />
          )}
          <Button variant="outline" asChild>
            <Link to={`/b/${branch.code}/inventory`}>Back</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['', ...MOVEMENT_TYPES] as const).map((t) => (
          <button
            key={t || 'all'}
            type="button"
            onClick={() => setType(t)}
            aria-pressed={type === t}
            className={cn('rounded-full border px-3 py-1 text-xs', type === t && 'bg-gray-900 text-white')}
          >
            {t ? TYPE_LABEL[t] : 'All'}
          </button>
        ))}
        <span className="ml-2 text-xs text-gray-500">From</span>
        <Input
          type="date"
          aria-label="From"
          className="h-8 w-40"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-xs text-gray-500">to</span>
        <Input
          type="date"
          aria-label="To"
          className="h-8 w-40"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date/time</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Change</TableHead>
            <TableHead className="text-right">After</TableHead>
            {showCost && <TableHead className="text-right">Unit cost</TableHead>}
            <TableHead>Document</TableHead>
            <TableHead>By</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((m) => {
            const href = docHref(branch.code, m.refType, m.refId);
            return (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap">{dateTime(m.createdAt)}</TableCell>
                <TableCell>{m.reason ? REASON_LABEL[m.reason] : TYPE_LABEL[m.type]}</TableCell>
                <TableCell
                  className={cn(
                    'text-right tabular-nums',
                    m.qtyChange < 0 ? 'text-red-700' : 'text-green-700',
                  )}
                >
                  {m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange}
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.quantityAfter}</TableCell>
                {showCost && (
                  <TableCell className="text-right tabular-nums">{money(m.unitCost ?? 0)}</TableCell>
                )}
                <TableCell className="font-mono text-xs">
                  {href ? (
                    <Link className="underline" to={href}>
                      {m.refNo}
                    </Link>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger className="cursor-help underline decoration-dotted">
                        {m.refNo}
                      </TooltipTrigger>
                      <TooltipContent>
                        {m.reason ? REASON_LABEL[m.reason] : 'Adjustment'}
                        {m.note ? `: ${m.note}` : ''}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>{m.userName}</TableCell>
              </TableRow>
            );
          })}
          {!moves.isPending && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-gray-500">
                No movements match these filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {moves.hasNextPage && (
        <Button variant="outline" onClick={() => moves.fetchNextPage()} disabled={moves.isFetchingNextPage}>
          {moves.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}

function ReorderEditor({ productId, level }: { productId: string; level: number }) {
  const branch = useBranch();
  const invalidate = useInvalidateStock(branch.code);
  const [value, setValue] = useState(String(level));
  const valid = /^\d+$/.test(value.trim());
  const save = useMutation({
    mutationFn: () =>
      http.patch(`/b/${branch.code}/inventory/${productId}`, { reorderLevel: Number(value.trim()) }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Reorder level saved');
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <form
      className="flex items-center gap-1 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <label htmlFor="reorder" className="text-gray-500">
        Reorder at
      </label>
      <Input
        id="reorder"
        className="h-8 w-20"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        type="submit"
        disabled={!valid || save.isPending || Number(value) === level}
      >
        Save
      </Button>
    </form>
  );
}
