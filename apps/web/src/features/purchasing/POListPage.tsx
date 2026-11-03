import { Link, useNavigate, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { PO_STATUSES, type Page, type PORowDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Can } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { useFormat } from '@/lib/useFormat';
import { cn } from '@/lib/utils';
import { PO_STATUS_LABEL, poPath, useAllSuppliers } from './hooks';
import { POStatusBadge } from './POStatusBadge';

const TABS = [
  ['open', 'Open'],
  ...PO_STATUSES.map((s) => [s, PO_STATUS_LABEL[s]] as const),
  ['all', 'All'],
] as const;
const select = 'h-9 rounded-md border bg-transparent px-3 text-sm';

/** /b/:code/purchase-orders (FR-PO-10). "Open" (ordered + partially received) is the default tab. */
export function POListPage() {
  const branch = useBranch();
  const navigate = useNavigate();
  const { money, dateTime } = useFormat();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'open';
  const supplierId = params.get('supplierId') ?? '';
  const suppliers = useAllSuppliers('all'); // filter by any supplier, active or not
  const setParam = (key: string, value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );

  const f = { status, supplierId };
  const list = useInfiniteQuery({
    queryKey: qk.pos(branch.code, f),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams();
      if (status !== 'all') sp.set('status', status);
      if (supplierId) sp.set('supplierId', supplierId);
      if (pageParam) sp.set('cursor', pageParam);
      return http.get<Page<PORowDto>>(`${poPath(branch.code)}?${sp}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Purchase orders · {branch.code}</h1>
        <Can permission="po:manage">
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to={`${poPath(branch.code)}/new?from=low-stock`}>From low stock</Link>
            </Button>
            <Button asChild>
              <Link to={`${poPath(branch.code)}/new`}>New purchase order</Link>
            </Button>
          </div>
        </Can>
      </div>

      <div role="tablist" aria-label="Status" className="flex flex-wrap gap-1">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={status === value}
            onClick={() => setParam('status', value === 'open' ? '' : value)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm',
              status === value ? 'border-gray-900 bg-gray-900 text-white' : 'hover:bg-gray-50',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-gray-600">Supplier</span>
        <select
          className={select}
          value={supplierId}
          onChange={(e) => setParam('supplierId', e.target.value)}
        >
          <option value="">Any</option>
          {suppliers.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {!s.isActive && ' (inactive)'}
            </option>
          ))}
        </select>
      </label>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>PO number</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Lines</TableHead>
            <TableHead className="text-right">Ordered value</TableHead>
            <TableHead>Expected</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.id}
              className="cursor-pointer"
              onClick={() => navigate(poPath(branch.code, r.id))}
            >
              <TableCell className="font-mono text-xs">{r.poNumber}</TableCell>
              <TableCell>{r.supplierName}</TableCell>
              <TableCell>
                <POStatusBadge status={r.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{r.lineCount}</TableCell>
              <TableCell className="text-right tabular-nums">{money(r.orderedValue)}</TableCell>
              <TableCell>{r.expectedDate ?? '—'}</TableCell>
              <TableCell className="whitespace-nowrap">{dateTime(r.createdAt)}</TableCell>
            </TableRow>
          ))}
          {!list.isPending && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-gray-500">
                No purchase orders here.
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
    </div>
  );
}
