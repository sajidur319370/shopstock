import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { LowStockListDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { useCategories } from '@/features/catalog/hooks';
import { LowStockStatus } from './LowStockStatus';
import { POLLING, useLostAccess } from './polling';

const select = 'h-9 rounded-md border bg-transparent px-3 text-sm';

/** /b/:code/low-stock (inventory:view, FR-DSH-05). Filters in the URL; a sale in another tab can push items on. */
export function LowStockPage() {
  const branch = useBranch();
  const navigate = useNavigate();
  const { can } = useActor();
  const categories = useCategories();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const categoryId = params.get('categoryId') ?? '';
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const canOrder = can('po:manage');
  const canHistory = can('movement:view');

  const q = useQuery({
    queryKey: qk.lowStock(branch.code, { status, categoryId }),
    queryFn: () => {
      const sp = new URLSearchParams();
      if (status) sp.set('status', status);
      if (categoryId) sp.set('categoryId', categoryId);
      return http.get<LowStockListDto>(`/b/${branch.code}/low-stock?${sp}`);
    },
    ...POLLING,
  });
  useLostAccess(q.error, branch.code);
  const rows = q.data?.items ?? [];
  const chosen = rows.filter((r) => picked.has(r.productId)); // ticks of rows that left the list don't count
  const setParam = (key: string, value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Low stock · {branch.code}</h1>
        {canOrder && (
          <Button
            disabled={chosen.length === 0}
            onClick={() =>
              navigate(
                `/b/${branch.code}/purchase-orders/new?from=low-stock&products=${chosen.map((r) => r.productId).join(',')}`,
              )
            }
          >
            Create PO from {chosen.length} selected
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Status"
          className={select}
          value={status}
          onChange={(e) => setParam('status', e.target.value)}
        >
          <option value="">Low and out</option>
          <option value="low">Low only</option>
          <option value="out">Out only</option>
        </select>
        <select
          aria-label="Category"
          className={select}
          value={categoryId}
          onChange={(e) => setParam('categoryId', e.target.value)}
        >
          <option value="">Any category</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {!q.data ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-gray-600">
          Nothing is low at {branch.code}
          {status || categoryId ? ' with these filters' : ''}: every stocked item is above its reorder level.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {canOrder && <TableHead className="w-8" />}
              <TableHead>Status</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Reorder at</TableHead>
              <TableHead className="text-right">Suggested</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.productId}>
                {canOrder && (
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.name}`}
                      checked={picked.has(r.productId)}
                      onChange={(e) => toggle(r.productId, e.target.checked)}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <LowStockStatus status={r.status} />
                </TableCell>
                <TableCell>
                  {canHistory ? (
                    <Link className="underline" to={`/b/${branch.code}/inventory/${r.productId}`}>
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">{r.reorderLevel}</TableCell>
                <TableCell className="text-right tabular-nums">{r.suggestedQty}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {q.data?.truncated && (
        <p className="text-sm text-amber-700">
          Showing the 500 most urgent items. Filter by category to see the rest.
        </p>
      )}
    </div>
  );
}
