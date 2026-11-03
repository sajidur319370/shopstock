import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Page, ReturnRowDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { METHOD_LABEL, toInvoiceNo } from '@/features/sales/hooks';
import { useFormat } from '@/lib/useFormat';
import { REASON_LABEL } from './hooks';

const FILTERS = ['from', 'to', 'invoiceNo'] as const;

/** /b/:code/returns (Manager+). Filters live in the URL, like the sales history. */
export function ReturnsPage() {
  const branch = useBranch();
  const { can } = useActor();
  const { money, dateTime } = useFormat();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
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
  const [invoice, setInvoice] = useState(f.invoiceNo);

  const list = useInfiniteQuery({
    queryKey: qk.returns(branch.code, f),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
      if (pageParam) sp.set('cursor', pageParam);
      return http.get<Page<ReturnRowDto>>(`/b/${branch.code}/returns?${sp}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Returns · {branch.code}</h1>
        {can('return:create') && (
          <Button asChild>
            <Link to={`/b/${branch.code}/returns/new`}>New return</Link>
          </Button>
        )}
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
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter('invoiceNo', invoice.trim() ? toInvoiceNo(branch.code, invoice) : '');
          }}
        >
          <Input
            aria-label="Invoice number"
            className="h-9 w-48 font-mono"
            placeholder={`Invoice: ${branch.code}-000124`}
            value={invoice}
            onChange={(e) => setInvoice(e.target.value)}
          />
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
        </form>
        {FILTERS.some((k) => f[k]) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setInvoice('');
              setParams({}, { replace: true });
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Return</TableHead>
            <TableHead>Invoice</TableHead>
            <TableHead className="text-right">Items</TableHead>
            <TableHead className="text-right">Refund</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>By</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.id}
              className="cursor-pointer"
              onClick={() => navigate(`/b/${branch.code}/returns/${r.id}`)}
            >
              <TableCell className="whitespace-nowrap">{dateTime(r.createdAt)}</TableCell>
              <TableCell className="font-mono text-xs">{r.returnNo}</TableCell>
              <TableCell className="font-mono text-xs">{r.invoiceNo}</TableCell>
              <TableCell className="text-right tabular-nums">{r.itemCount}</TableCell>
              <TableCell className="text-right tabular-nums">{money(r.refund.amount)}</TableCell>
              <TableCell>{METHOD_LABEL[r.refund.method]}</TableCell>
              <TableCell>{REASON_LABEL[r.reason]}</TableCell>
              <TableCell>{r.processedByName}</TableCell>
            </TableRow>
          ))}
          {!list.isPending && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-gray-500">
                No returns match these filters.
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
