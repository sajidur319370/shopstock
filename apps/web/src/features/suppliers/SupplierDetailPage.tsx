import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SupplierDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Can } from '@/features/auth/useActor';
import { POStatusBadge } from '@/features/purchasing/POStatusBadge';
import { useFormat } from '@/lib/useFormat';
import { useSupplier } from './hooks';

/** /suppliers/:id: contact card, (de)activate, and the recent POs of MY branches (FR-SUP-02/03). */
export function SupplierDetailPage() {
  const { id = '' } = useParams();
  const detail = useSupplier(id);
  const qc = useQueryClient();
  const { money, dateTime } = useFormat();
  const [confirm, setConfirm] = useState(false);

  const toggle = useMutation({
    mutationFn: (isActive: boolean) =>
      http.patch<{ supplier: SupplierDto }>(`/suppliers/${id}`, { isActive }),
    onSuccess: async ({ supplier }) => {
      await qc.invalidateQueries({ queryKey: ['supplier', id] });
      await qc.invalidateQueries({ queryKey: ['suppliers'] });
      setConfirm(false);
      toast.success(`${supplier.name} is now ${supplier.isActive ? 'active' : 'inactive'}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (detail.isError) return <p className="text-red-600">Supplier not found.</p>;
  if (!detail.data) return <Skeleton className="h-64 w-full" />;
  const { supplier: s, recentPOs } = detail.data;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            {s.name}
            {!s.isActive && <Badge variant="outline">Inactive</Badge>}
          </h1>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
            {(
              [
                ['Contact', s.contactName],
                ['Phone', s.phone],
                ['Email', s.email],
                ['Address', s.address],
              ] as const
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-gray-500">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          {s.notes && <p className="text-sm whitespace-pre-line text-gray-600">{s.notes}</p>}
        </div>
        <Can permission="supplier:manage">
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to={`/suppliers/${s.id}/edit`}>Edit</Link>
            </Button>
            {s.isActive ? (
              <Button variant="outline" onClick={() => setConfirm(true)}>
                Deactivate
              </Button>
            ) : (
              <Button variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(true)}>
                Reactivate
              </Button>
            )}
          </div>
        </Can>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">Recent purchase orders</h2>
        {recentPOs.length === 0 ? (
          <p className="text-sm text-gray-500">No purchase orders from this supplier at your branches yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO number</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ordered value</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentPOs.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link className="font-mono underline" to={`/b/${p.branchCode}/purchase-orders/${p.id}`}>
                      {p.poNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{p.branchCode}</TableCell>
                  <TableCell>
                    <POStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(p.orderedValue)}</TableCell>
                  <TableCell className="whitespace-nowrap">{dateTime(p.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Deactivate ${s.name}?`}
        description="Existing POs continue; no new POs can use this supplier."
        confirmLabel="Deactivate"
        destructive
        pending={toggle.isPending}
        onConfirm={() => toggle.mutate(false)}
      />
    </div>
  );
}
