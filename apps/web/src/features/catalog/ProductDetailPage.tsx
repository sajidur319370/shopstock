import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, http } from '@/api/client';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusChip } from '@/features/inventory/StatusChip';
import { useFormat } from '@/lib/useFormat';
import { useCategories, useProduct } from './hooks';

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { money } = useFormat();
  const detail = useProduct(id);
  const categories = useCategories();
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['product', id] }),
      qc.invalidateQueries({ queryKey: ['products'] }),
    ]);
  const setActive = useMutation({
    mutationFn: (isActive: boolean) => http.patch(`/products/${id}`, { isActive }),
    onSuccess: async (_r, isActive) => {
      await refresh();
      toast.success(isActive ? 'Product restored' : 'Product archived');
      setConfirm(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => http.delete(`/products/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product deleted');
      navigate('/catalog/products', { replace: true });
    },
    onError: (e) => {
      setConfirm(null);
      toast.error(
        e instanceof ApiError && e.code === 'PRODUCT_IN_USE'
          ? 'It has stock history: archive it instead.'
          : e.message,
      );
    },
  });

  if (detail.isPending) return <p className="text-gray-500">Loading…</p>;
  if (!detail.data) return <p className="text-red-600">Product not found.</p>;
  const { product: p, stock } = detail.data;
  const showCost = stock.some((s) => s.avgCost !== undefined); // the API only sends cost to Manager+
  const category = categories.data?.find((c) => c.id === p.categoryId)?.name ?? '—';

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {p.name} {!p.isActive && <Badge variant="outline">Archived</Badge>}
          </h1>
          <p className="text-sm text-gray-500">
            <span className="font-mono">{p.sku}</span>
            {p.barcode && <span className="font-mono"> · {p.barcode}</span>} · {category} · per {p.unit}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to={`/catalog/products/${p.id}/edit`}>Edit</Link>
          </Button>
          <Button variant="outline" onClick={() => setConfirm('archive')}>
            {p.isActive ? 'Archive' : 'Restore'}
          </Button>
          {stock.length === 0 && (
            <Button variant="ghost" onClick={() => setConfirm('delete')}>
              Delete
            </Button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
        <div>
          <dt className="text-gray-500">Price</dt>
          <dd className="text-lg font-medium tabular-nums">{money(p.price)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Default reorder level</dt>
          <dd className="text-lg font-medium">{p.reorderLevel}</dd>
        </div>
      </dl>

      <section className="space-y-2">
        <h2 className="font-medium">Stock at my branches</h2>
        {stock.length === 0 ? (
          <p className="text-sm text-gray-500">Not stocked at any of your branches yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reorder at</TableHead>
                <TableHead>Status</TableHead>
                {showCost && <TableHead className="text-right">Avg cost</TableHead>}
                {showCost && <TableHead className="text-right">Value</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {stock.map((s) => (
                <TableRow key={s.branchId}>
                  <TableCell className="font-mono">
                    <Link className="underline" to={`/b/${s.branchCode}/inventory/${p.id}`}>
                      {s.branchCode}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.reorderLevel}</TableCell>
                  <TableCell>
                    <StatusChip status={s.status} />
                  </TableCell>
                  {showCost && (
                    <TableCell className="text-right tabular-nums">{money(s.avgCost ?? 0)}</TableCell>
                  )}
                  {showCost && (
                    <TableCell className="text-right tabular-nums">
                      {money((s.avgCost ?? 0) * s.quantity)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <ConfirmDialog
        open={confirm === 'archive'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={p.isActive ? `Archive ${p.name}?` : `Restore ${p.name}?`}
        description={
          p.isActive
            ? 'It disappears from the POS and ordering. Its history stays, and you can restore it any time.'
            : 'It can be sold and ordered again.'
        }
        confirmLabel={p.isActive ? 'Archive' : 'Restore'}
        pending={setActive.isPending}
        onConfirm={() => setActive.mutate(!p.isActive)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${p.name}?`}
        description="This can't be undone. Only possible while it has never been stocked."
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
