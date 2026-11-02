import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Page, ProductDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounce } from '@/lib/useDebounce';
import { useFormat } from '@/lib/useFormat';
import { useCategories } from './hooks';

const selectClass = 'h-9 rounded-md border bg-transparent px-3 text-sm';

/** Filters live in the URL, so a filtered list can be bookmarked and survives a reload. */
export function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { money } = useFormat();
  const categories = useCategories();
  const categoryId = params.get('categoryId') ?? '';
  const active = params.get('active') ?? 'true';
  const [q, setQ] = useState(params.get('q') ?? '');
  const debouncedQ = useDebounce(q.trim(), 250);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const filters = { categoryId, active, q: debouncedQ };
  const list = useInfiniteQuery({
    queryKey: qk.products(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ active });
      if (categoryId) sp.set('categoryId', categoryId);
      if (debouncedQ) sp.set('q', debouncedQ);
      if (pageParam) sp.set('cursor', pageParam);
      return http.get<Page<ProductDto>>(`/products?${sp}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const catName = new Map((categories.data ?? []).map((c) => [c.id, c.name]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Products</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/catalog/categories">Categories</Link>
          </Button>
          <Button asChild>
            <Link to="/catalog/products/new">New product</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="w-60"
          placeholder="Name starts with…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            set('q', e.target.value.trim());
          }}
        />
        <select
          aria-label="Category"
          className={selectClass}
          value={categoryId}
          onChange={(e) => set('categoryId', e.target.value)}
        >
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          className={selectClass}
          value={active}
          onChange={(e) => set('active', e.target.value === 'true' ? '' : e.target.value)}
        >
          <option value="true">Active</option>
          <option value="false">Archived</option>
          <option value="all">All</option>
        </select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead className="hidden md:table-cell">Barcode</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow
              key={p.id}
              className="cursor-pointer"
              onClick={() => navigate(`/catalog/products/${p.id}`)}
            >
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell className="font-mono text-xs">{p.sku}</TableCell>
              <TableCell className="hidden font-mono text-xs md:table-cell">{p.barcode ?? '—'}</TableCell>
              <TableCell className="hidden md:table-cell">{catName.get(p.categoryId) ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{money(p.price)}</TableCell>
              <TableCell>
                {p.isActive ? (
                  <Badge variant="secondary">Active</Badge>
                ) : (
                  <Badge variant="outline">Archived</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
          {!list.isPending && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-gray-500">
                No products match these filters.
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
