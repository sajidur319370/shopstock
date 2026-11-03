import { useSearchParams } from 'react-router';
import type { BestSellersDto } from '@shopstock/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCategories } from '@/features/catalog/hooks';
import { Empty, useReport, useReportFormat, type ReportScope } from './shared';

const SORTS = [
  ['qty', 'Quantity'],
  ['revenue', 'Net revenue'],
  ['profit', 'Profit'],
] as const;
const LIMITS = [10, 20, 50, 100] as const;
const select = 'h-9 rounded-md border bg-transparent px-3 text-sm';

/**
 * FR-RPT-02: a table. Changing the sort is a NEW request: the top 20 by profit aren't the top 20 by
 * quantity re-sorted.
 */
export function BestSellersReport({ scope }: { scope: ReportScope }) {
  const [params, setParams] = useSearchParams();
  const sortBy = (params.get('sortBy') ?? 'qty') as (typeof SORTS)[number][0];
  const limit = Number(params.get('limit') ?? 20);
  const categoryId = params.get('categoryId') ?? '';
  const categories = useCategories();
  const catName = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
  const q = useReport<BestSellersDto>('best-sellers', {
    ...scope,
    branchIds: scope.branchIds.join(','),
    sortBy,
    limit,
    categoryId,
  });
  const { money, pct } = useReportFormat();
  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        if (v) p.set(k, v);
        else p.delete(k);
        return p;
      },
      { replace: true },
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-2 text-sm">
          Sort by
          <select className={select} value={sortBy} onChange={(e) => set('sortBy', e.target.value)}>
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Top
          <select className={select} value={limit} onChange={(e) => set('limit', e.target.value)}>
            {LIMITS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <select
          aria-label="Category"
          className={select}
          value={categoryId}
          onChange={(e) => set('categoryId', e.target.value)}
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
        <Skeleton className="h-64 w-full" />
      ) : q.data.rows.length === 0 ? (
        <Empty>Nothing was sold in this period.</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Net revenue</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">Margin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.rows.map((r, i) => (
              <TableRow key={r.productId}>
                <TableCell className="tabular-nums text-gray-500">{i + 1}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                <TableCell>{(r.categoryId && catName.get(r.categoryId)) ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{r.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{money(r.revenue)}</TableCell>
                <TableCell className={`text-right tabular-nums ${r.profit < 0 ? 'text-red-700' : ''}`}>
                  {money(r.profit)}
                  {r.profit < 0 && ' loss'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{pct(r.marginBps)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
