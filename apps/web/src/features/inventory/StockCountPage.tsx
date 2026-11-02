import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AdjustmentResultDto, InventoryRowDto } from '@shopstock/shared';
import { ApiError, http } from '@/api/client';
import { MoneyInput } from '@/components/MoneyInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useBranch } from '@/features/branch/useBranch';
import { useCategories } from '@/features/catalog/hooks';
import { cn } from '@/lib/utils';
import { fetchAllInventory, useInvalidateStock } from './hooks';

/** /b/:code/inventory/count: the manager walks the shelves with a tablet. */
export function StockCountPage() {
  const branch = useBranch();
  const categories = useCategories();
  const [categoryId, setCategoryId] = useState('');
  const rows = useQuery({
    queryKey: ['inventory', branch.code, { count: true, categoryId }],
    queryFn: () => fetchAllInventory(branch.code, categoryId || undefined),
    staleTime: Infinity, // never refresh behind the counter's back: "System" must stay what they saw
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Stock count · {branch.code}</h1>
        <div className="flex items-center gap-2">
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
          <Button variant="outline" asChild>
            <Link to={`/b/${branch.code}/inventory`}>Back to inventory</Link>
          </Button>
        </div>
      </div>
      {rows.isPending && <p className="text-gray-500">Loading…</p>}
      {rows.data && (
        // A fresh sheet per load: the "System" numbers are frozen at the moment the screen loaded.
        <CountSheet
          key={`${categoryId}:${rows.dataUpdatedAt}`}
          rows={rows.data}
          onDone={() => rows.refetch()}
        />
      )}
    </div>
  );
}

type Changed = { productId: string; current: number };

function CountSheet({ rows, onDone }: { rows: InventoryRowDto[]; onDone: () => void }) {
  const branch = useBranch();
  const invalidate = useInvalidateStock(branch.code);
  const [expected, setExpected] = useState<Record<string, number>>(() =>
    Object.fromEntries(rows.map((r) => [r.productId, r.quantity])),
  );
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, number | null>>({});
  const [stale, setStale] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const counted = (id: string): number | null => {
    const t = (counts[id] ?? '').trim();
    return /^\d+$/.test(t) ? Number(t) : null;
  };
  const invalid = rows.filter(
    (r) => (counts[r.productId] ?? '').trim() !== '' && counted(r.productId) === null,
  );
  const lines = rows
    .filter((r) => counted(r.productId) !== null && counted(r.productId) !== expected[r.productId])
    .map((r) => ({
      productId: r.productId,
      expectedQty: expected[r.productId]!,
      countedQty: counted(r.productId)!,
      unitCost: r.status === 'not_stocked' ? (costs[r.productId] ?? undefined) : undefined,
    }));
  const missingCost = lines.filter(
    (l) => l.countedQty > 0 && l.expectedQty === 0 && l.unitCost === undefined,
  );
  const needsCost = (r: InventoryRowDto) => r.status === 'not_stocked' && (counted(r.productId) ?? 0) > 0;

  const submit = useMutation({
    mutationFn: () => http.post<AdjustmentResultDto>(`/b/${branch.code}/stock-counts`, { note, lines }),
    onSuccess: async (res) => {
      await invalidate();
      toast.success(
        res.refNo ? `Saved ${res.refNo} (${res.lines} corrected)` : 'Everything matched: nothing to correct',
      );
      onDone();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'STOCK_CHANGED' && Array.isArray(err.details)) {
        // Update "System" for those lines to the CURRENT number, keep every typed count, highlight them.
        const changed = err.details as Changed[];
        setExpected((e) => ({ ...e, ...Object.fromEntries(changed.map((c) => [c.productId, c.current])) }));
        setStale(new Set(changed.map((c) => c.productId)));
        setProblem(
          `${changed.length} item(s) changed while you counted. Re-check the highlighted lines and submit again.`,
        );
      } else setProblem(err instanceof Error ? err.message : 'Something went wrong');
    },
  });

  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-2 font-normal">Product</th>
            <th className="py-2 text-right font-normal">System</th>
            <th className="w-28 py-2 font-normal">Counted</th>
            <th className="py-2 text-right font-normal">Difference</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const c = counted(r.productId);
            const diff = c === null ? null : c - expected[r.productId]!;
            return (
              <tr key={r.productId} className={cn('border-b', stale.has(r.productId) && 'bg-amber-50')}>
                <td className="py-1.5">
                  {r.name}
                  {stale.has(r.productId) && (
                    <span className="ml-2 text-xs text-amber-700">changed: re-check</span>
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums">{expected[r.productId]}</td>
                <td className="py-1.5">
                  <Input
                    inputMode="numeric"
                    aria-label={`Counted ${r.name}`}
                    aria-invalid={invalid.includes(r)}
                    value={counts[r.productId] ?? ''}
                    onChange={(e) => setCounts((s) => ({ ...s, [r.productId]: e.target.value }))}
                  />
                </td>
                <td
                  className={cn(
                    'py-1.5 text-right tabular-nums',
                    diff && diff < 0 && 'text-red-700',
                    diff && diff > 0 && 'text-green-700',
                  )}
                >
                  {diff === null ? '' : diff > 0 ? `+${diff}` : diff}
                </td>
                <td className="py-1.5 pl-2">
                  {needsCost(r) && (
                    <div className="w-40">
                      <MoneyInput
                        aria-invalid={missingCost.some((l) => l.productId === r.productId)}
                        value={costs[r.productId] ?? null}
                        onChange={(v) => setCosts((s) => ({ ...s, [r.productId]: v }))}
                        placeholder="Unit cost"
                      />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Textarea
        placeholder="Note (optional), e.g. Monthly count"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {invalid.length > 0 && <p className="text-sm text-red-600">Counts must be whole numbers.</p>}
      {missingCost.length > 0 && (
        <p className="text-sm text-red-600">Enter a unit cost for products that had no stock here.</p>
      )}
      {problem && <p className="rounded bg-amber-100 p-2 text-sm text-amber-900">{problem}</p>}
      <div className="flex items-center gap-3">
        <Button
          onClick={() => {
            setProblem(null);
            setStale(new Set());
            submit.mutate();
          }}
          disabled={submit.isPending || invalid.length > 0 || missingCost.length > 0}
        >
          {submit.isPending ? 'Submitting…' : `Submit count (${lines.length} to correct)`}
        </Button>
        <span className="text-sm text-gray-500">Only lines where your count differs are sent.</span>
      </div>
    </div>
  );
}
