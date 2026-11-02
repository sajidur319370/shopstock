import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  PAYMENT_METHODS,
  SALE_RETURN_STATUSES,
  type Page,
  type SaleDto,
  type SaleRowDto,
  type StaffDto,
} from '@shopstock/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { useFormat } from '@/lib/useFormat';
import { METHOD_LABEL, toInvoiceNo } from './hooks';

const FILTERS = ['from', 'to', 'cashierId', 'method', 'returnStatus'] as const;
const RETURN_LABEL = { none: 'No returns', partial: 'Partly returned', full: 'Returned' } as const;
const select = 'h-9 rounded-md border bg-transparent px-3 text-sm';

/** /b/:code/sales (FR-SAL-10). Filters live in the URL, so a filtered view can be bookmarked or shared. */
export function SalesHistoryPage() {
  const branch = useBranch();
  const { user, can } = useActor();
  const { money, dateTime } = useFormat();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const viewAll = can('sale:viewAll'); // cashiers: the API returns only their own sales anyway
  const f = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ''])) as Record<
    (typeof FILTERS)[number],
    string
  >;
  const setFilter = (key: (typeof FILTERS)[number], value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );

  const list = useInfiniteQuery({
    queryKey: qk.sales(branch.code, f),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
      if (pageParam) sp.set('cursor', pageParam);
      return http.get<Page<SaleRowDto>>(`/b/${branch.code}/sales?${sp}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  // Managers filter by cashier: everyone assigned to this branch, plus me (the Owner isn't in /staff).
  const staff = useQuery({
    queryKey: qk.staff,
    queryFn: () => http.get<{ staff: StaffDto[] }>('/staff').then((r) => r.staff),
    enabled: viewAll && can('staff:view'),
  });
  const cashiers = [
    { id: user.id, name: `${user.name} (me)` },
    ...(staff.data ?? []).filter((s) => s.id !== user.id && s.branchIds.includes(branch.id)),
  ];

  // Invoice lookup: "124" → GUL-000124 → straight to the detail page.
  const [invoice, setInvoice] = useState('');
  const findInvoice = async () => {
    const no = toInvoiceNo(branch.code, invoice);
    if (!no) return;
    try {
      const { sale } = await http.get<{ sale: SaleDto }>(
        `/b/${branch.code}/sales/by-invoice/${encodeURIComponent(no)}`,
      );
      navigate(`/b/${branch.code}/sales/${sale.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 404 ? `No sale ${no} here.` : (e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          {viewAll ? 'Sales' : 'My sales'} · {branch.code}
        </h1>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void findInvoice();
          }}
        >
          <Input
            aria-label="Invoice number"
            className="w-48 font-mono"
            placeholder={`${branch.code}-000124 or 124`}
            value={invoice}
            onChange={(e) => setInvoice(e.target.value)}
          />
          <Button type="submit" variant="outline">
            Open
          </Button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">From</span>
        <Input
          type="date"
          aria-label="From"
          className="h-9 w-40"
          value={f.from}
          onChange={(e) => setFilter('from', e.target.value)}
        />
        <span className="text-xs text-gray-500">to</span>
        <Input
          type="date"
          aria-label="To"
          className="h-9 w-40"
          value={f.to}
          onChange={(e) => setFilter('to', e.target.value)}
        />
        {viewAll && (
          <select
            aria-label="Cashier"
            className={select}
            value={f.cashierId}
            onChange={(e) => setFilter('cashierId', e.target.value)}
          >
            <option value="">All cashiers</option>
            {cashiers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Payment method"
          className={select}
          value={f.method}
          onChange={(e) => setFilter('method', e.target.value)}
        >
          <option value="">Any payment</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </select>
        <select
          aria-label="Returns"
          className={select}
          value={f.returnStatus}
          onChange={(e) => setFilter('returnStatus', e.target.value)}
        >
          <option value="">Any return status</option>
          {SALE_RETURN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {RETURN_LABEL[s]}
            </option>
          ))}
        </select>
        {FILTERS.some((k) => f[k]) && (
          <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
            Clear
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Invoice</TableHead>
            {viewAll && <TableHead>Cashier</TableHead>}
            <TableHead className="text-right">Items</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Paid by</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.id}
              className="cursor-pointer"
              onClick={() => navigate(`/b/${branch.code}/sales/${r.id}`)}
            >
              <TableCell className="whitespace-nowrap">{dateTime(r.createdAt)}</TableCell>
              <TableCell className="font-mono text-xs">{r.invoiceNo}</TableCell>
              {viewAll && <TableCell>{r.cashierName}</TableCell>}
              <TableCell className="text-right tabular-nums">{r.itemCount}</TableCell>
              <TableCell className="text-right tabular-nums">{money(r.total)}</TableCell>
              <TableCell>{r.methods.map((m) => METHOD_LABEL[m]).join(' + ')}</TableCell>
              <TableCell>
                {r.returnStatus !== 'none' && (
                  <Badge variant={r.returnStatus === 'full' ? 'destructive' : 'secondary'}>
                    {RETURN_LABEL[r.returnStatus]}
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
          {!list.isPending && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-gray-500">
                No sales match these filters.
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
