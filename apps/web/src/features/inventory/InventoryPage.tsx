import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { InventoryRowDto, Page } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { useCategories } from '@/features/catalog/hooks';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/lib/useDebounce';
import { useFormat } from '@/lib/useFormat';
import { AdjustmentDialog } from './AdjustmentDialog';
import { inventoryPath } from './hooks';
import { StatusChip } from './StatusChip';

export function InventoryPage() {
  const branch = useBranch();
  const { can } = useActor();
  const { money } = useFormat();
  const navigate = useNavigate();
  const categories = useCategories();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const debouncedQ = useDebounce(q.trim(), 250);

  const list = useInfiniteQuery({
    queryKey: qk.inventory(branch.code, { q: debouncedQ, categoryId }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      http.get<Page<InventoryRowDto>>(
        inventoryPath(branch.code, { q: debouncedQ, categoryId, cursor: pageParam }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  // Cost columns only if the API sent cost (it never does to cashiers): the UI doesn't decide, the DTO does.
  const showCost = rows.some((r) => r.avgCost !== undefined);
  const canHistory = can('movement:view');
  const canAdjust = can('inventory:adjust') && branch.isActive;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Inventory · {branch.code}</h1>
        {canAdjust && (
          <div className="flex gap-2">
            <Button onClick={() => setAdjusting(true)}>Opening stock / adjust</Button>
            <Button variant="outline" asChild>
              <Link to={`/b/${branch.code}/inventory/count`}>Stock count</Link>
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input className="w-60" placeholder="Search name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select
          aria-label="Category"
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="hidden md:table-cell">SKU</TableHead>
            <TableHead className="text-right">On hand</TableHead>
            <TableHead className="text-right">Reorder</TableHead>
            <TableHead>Status</TableHead>
            {showCost && <TableHead className="text-right">Avg cost</TableHead>}
            {showCost && <TableHead className="text-right">Value</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const stocked = r.status !== 'not_stocked';
            return (
              <TableRow
                key={r.productId}
                className={cn(canHistory && stocked && 'cursor-pointer')}
                onClick={() =>
                  canHistory && stocked && navigate(`/b/${branch.code}/inventory/${r.productId}`)
                }
              >
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="hidden font-mono text-xs md:table-cell">{r.sku}</TableCell>
                <TableCell className="text-right tabular-nums">{stocked ? r.quantity : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{stocked ? r.reorderLevel : '—'}</TableCell>
                <TableCell>
                  <StatusChip status={r.status} />
                </TableCell>
                {showCost && (
                  <TableCell className="text-right tabular-nums">
                    {r.avgCost !== undefined ? money(r.avgCost) : ''}
                  </TableCell>
                )}
                {showCost && (
                  <TableCell className="text-right tabular-nums">
                    {r.value !== undefined ? money(r.value) : ''}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
          {!list.isPending && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-gray-500">
                No products match. Add products under Products first.
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

      {adjusting && <AdjustmentDialog onClose={() => setAdjusting(false)} />}
    </div>
  );
}
