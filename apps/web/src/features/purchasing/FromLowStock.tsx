import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PODto, POSuggestionDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { MoneyInput } from '@/components/MoneyInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBranch } from '@/features/branch/useBranch';
import { poPath, useAllSuppliers } from './hooks';

type Row = { picked: boolean; qty: number; cost: number | null };

/**
 * /b/:code/purchase-orders/new?from=low-stock[&products=id,id] (FR-PO-11). Suggestions don't know
 * suppliers (products have none): the manager ticks what THIS supplier delivers. Nothing is pre-ticked
 * unless ?products= says so. "Create draft" is a normal POST; lines can still change in the editor.
 */
export function FromLowStock() {
  const branch = useBranch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const preselected = new Set((params.get('products') ?? '').split(',').filter(Boolean));
  const suppliers = useAllSuppliers('true');
  const suggestions = useQuery({
    queryKey: qk.poSuggestions(branch.code),
    queryFn: () =>
      http
        .get<{ suggestions: POSuggestionDto[] }>(`${poPath(branch.code)}/suggestions`)
        .then((r) => r.suggestions),
  });
  const [supplierId, setSupplierId] = useState('');
  const [edits, setEdits] = useState<Record<string, Partial<Row>>>({});
  const [error, setError] = useState('');

  const rowOf = (s: POSuggestionDto): Row => ({
    picked: preselected.has(s.productId),
    qty: s.suggestedQty, // max(2 × reorderLevel − onHand, 1), from the server
    cost: s.lastCost, // the last receipt cost here, when there is one
    ...edits[s.productId],
  });
  const edit = (id: string, patch: Partial<Row>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));

  const rows = (suggestions.data ?? []).map((s) => ({ s, r: rowOf(s) }));
  const picked = rows.filter((x) => x.r.picked);
  const invalid = picked.some((x) => !(x.r.qty >= 1) || x.r.cost === null);

  const create = useMutation({
    mutationFn: () =>
      http.post<{ purchaseOrder: PODto }>(poPath(branch.code), {
        supplierId,
        lines: picked.map(({ s, r }) => ({ productId: s.productId, orderedQty: r.qty, unitCost: r.cost })),
      }),
    onSuccess: ({ purchaseOrder }) => {
      qc.setQueryData(qk.po(branch.code, purchaseOrder.id), purchaseOrder);
      void qc.invalidateQueries({ queryKey: ['pos', branch.code] });
      toast.success(`Draft ${purchaseOrder.poNumber} created`);
      navigate(`${poPath(branch.code, purchaseOrder.id)}/edit`); // review it in the editor
    },
    onError: (e) => setError((e as Error).message), // INVALID_SUPPLIER, PRODUCT_INACTIVE: the server's words
  });

  if (!suggestions.data || !suppliers.data) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">New purchase order from low stock · {branch.code}</h1>
      {rows.length === 0 ? (
        <p className="text-gray-600">
          Nothing is low at {branch.code} right now.{' '}
          <Link className="underline" to={`/b/${branch.code}/inventory`}>
            See the inventory
          </Link>
        </p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-600">Supplier</span>
            <select
              aria-label="Supplier"
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Choose a supplier…</option>
              {suppliers.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Product</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reorder</TableHead>
                <TableHead className="text-right">Suggested</TableHead>
                <TableHead className="w-28">Order qty</TableHead>
                <TableHead className="w-40">Unit cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ s, r }) => (
                <TableRow key={s.productId}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Order ${s.name}`}
                      checked={r.picked}
                      onChange={(e) => edit(s.productId, { picked: e.target.checked })}
                    />
                  </TableCell>
                  <TableCell>
                    {s.name} <span className="font-mono text-xs text-gray-500">{s.sku}</span>
                    {s.status === 'out' && <span className="ml-2 text-xs text-red-700">out of stock</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.reorderLevel}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.suggestedQty}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={1}
                      aria-label={`Order quantity for ${s.name}`}
                      className="h-8 text-right tabular-nums"
                      value={Number.isNaN(r.qty) ? '' : r.qty}
                      disabled={!r.picked}
                      onChange={(e) => edit(s.productId, { qty: e.target.valueAsNumber })}
                    />
                  </TableCell>
                  <TableCell>
                    <MoneyInput
                      aria-invalid={r.picked && r.cost === null}
                      value={r.cost}
                      onChange={(cost) => edit(s.productId, { cost })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" asChild>
              <Link to={poPath(branch.code)}>Cancel</Link>
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!supplierId || picked.length === 0 || invalid || create.isPending}
            >
              {create.isPending
                ? 'Creating…'
                : `Create draft with ${picked.length} line${picked.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
