import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Page, SupplierDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Can } from '@/features/auth/useActor';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';

const ACTIVE = [
  ['true', 'Active'],
  ['false', 'Inactive'],
  ['all', 'All'],
] as const;

/** /suppliers (FR-SUP-03): name prefix search and the active filter live in the URL. */
export function SuppliersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const active = (params.get('active') ?? 'true') as (typeof ACTIVE)[number][0];
  const [q, setQ] = useState(params.get('q') ?? '');
  const debounced = useDebounce(q.trim(), 200);
  const f = { active, q: debounced };

  const list = useInfiniteQuery({
    queryKey: qk.suppliers(f),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const sp = new URLSearchParams({ active });
      if (debounced) sp.set('q', debounced);
      if (pageParam) sp.set('cursor', pageParam);
      return http.get<Page<SupplierDto>>(`/suppliers?${sp}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const setParam = (key: string, value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Suppliers</h1>
        <Can permission="supplier:manage">
          <Button asChild>
            <Link to="/suppliers/new">New supplier</Link>
          </Button>
        </Can>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search suppliers"
          className="h-9 w-64"
          placeholder="Search by name…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setParam('q', e.target.value.trim());
          }}
        />
        <div role="group" aria-label="Status" className="flex overflow-hidden rounded-md border">
          {ACTIVE.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={active === value}
              onClick={() => setParam('active', value === 'true' ? '' : value)}
              className={cn('px-3 py-1.5 text-sm', active === value && 'bg-gray-900 text-white')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => (
            <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate(`/suppliers/${s.id}`)}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell>{s.contactName}</TableCell>
              <TableCell>{s.phone}</TableCell>
              <TableCell>{s.email}</TableCell>
              <TableCell>
                {s.isActive ? (
                  <Badge variant="secondary">Active</Badge>
                ) : (
                  <Badge variant="outline">Inactive</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
          {!list.isPending && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-gray-500">
                No suppliers match.
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
