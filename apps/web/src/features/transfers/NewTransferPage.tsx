import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { LIMITS, objectIdSchema, type InventoryRowDto, type TransferDto } from '@shopstock/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';
import { FormField } from '@/components/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useBranch } from '@/features/branch/useBranch';
import { ProductPicker } from '@/features/catalog/ProductPicker';
import { applyServerErrors } from '@/lib/formErrors';
import { transferPath } from './hooks';

const formSchema = z.object({
  toBranchCode: z.string().min(1, 'Choose a destination'),
  lines: z
    .array(
      z.object({
        productId: objectIdSchema,
        name: z.string(),
        sku: z.string(),
        qty: z
          .number({ error: 'Enter a quantity' })
          .int('Whole units only')
          .min(1, 'At least 1')
          .max(LIMITS.maxDocQty, 'Too large'),
      }),
    )
    .min(1, 'Add at least one product')
    .max(LIMITS.transferLines),
  note: z.string().max(500),
});
type FormValues = z.infer<typeof formSchema>;

/** Per-line messages carried to the detail page when "Save and dispatch" finds a short line. */
export type DispatchLineErrors = Record<string, string>;

/** /b/:code/transfers/new: THIS branch is the source (transfer:manage). */
export function NewTransferPage() {
  const branch = useBranch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const destinations = useQuery({
    queryKey: qk.transferDestinations(branch.code),
    queryFn: () =>
      http
        .get<{ branches: { code: string; name: string }[] }>(`${transferPath(branch.code)}/destinations`)
        .then((r) => r.branches),
    staleTime: 60_000,
  });
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { toBranchCode: '', lines: [], note: '' },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  const lines = useWatch({ control: form.control, name: 'lines' });
  const { errors, isSubmitting } = form.formState;

  const submit = (andDispatch: boolean) =>
    form.handleSubmit(async (v) => {
      let t: TransferDto;
      try {
        t = (
          await http.post<{ transfer: TransferDto }>(transferPath(branch.code), {
            toBranchCode: v.toBranchCode,
            lines: v.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
            note: v.note,
          })
        ).transfer;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'PRODUCT_INACTIVE' && Array.isArray(err.details)) {
          for (const d of err.details as { productId: string }[]) {
            const i = v.lines.findIndex((l) => l.productId === d.productId);
            if (i >= 0) form.setError(`lines.${i}.qty`, { message: 'Archived: remove this line' });
          }
        } else {
          applyServerErrors(err, form.setError, {
            INVALID_BRANCH: 'toBranchCode',
            SAME_BRANCH: 'toBranchCode',
          });
        }
        return;
      }
      void qc.invalidateQueries({ queryKey: ['transfers', branch.code] });
      const detail = transferPath(branch.code, t.id);
      if (!andDispatch) {
        toast.success(`${t.transferNo} saved: dispatch it when the goods leave.`);
        navigate(detail);
        return;
      }
      try {
        const d = (await http.post<{ transfer: TransferDto }>(`${detail}/dispatch`)).transfer;
        qc.setQueryData(qk.transfer(branch.code, d.id), d);
        for (const key of [
          'inventory',
          'inventory-row',
          'movements',
          'pos-search',
          'dashboard',
          'low-stock',
        ]) {
          void qc.invalidateQueries({ queryKey: [key, branch.code] });
        }
        toast.success(`${d.transferNo} is on its way to ${d.toCode}.`);
        navigate(detail);
      } catch (err) {
        // Saved but not dispatched: open it, with the short lines marked, so it can be fixed or cancelled.
        const lineErrors: DispatchLineErrors = {};
        if (err instanceof ApiError && err.code === 'INSUFFICIENT_STOCK' && Array.isArray(err.details)) {
          for (const d of err.details as { productId: string; available: number }[]) {
            lineErrors[d.productId] = `Only ${d.available} in stock`;
          }
        }
        toast.error(`${t.transferNo} was saved but not dispatched: ${(err as Error).message}`);
        navigate(detail, { state: { lineErrors } });
      }
    });

  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-xl font-semibold">New transfer from {branch.code}</h1>
      <form className="space-y-4" noValidate onSubmit={(e) => e.preventDefault()}>
        <FormField id="toBranchCode" label="Destination" error={errors.toBranchCode?.message}>
          <select
            id="toBranchCode"
            className="h-9 w-full max-w-sm rounded-md border bg-transparent px-3 text-sm"
            {...form.register('toBranchCode')}
          >
            <option value="">Choose a branch…</option>
            {destinations.data?.map((b) => (
              <option key={b.code} value={b.code}>
                {b.code} · {b.name}
              </option>
            ))}
          </select>
        </FormField>

        <div className="space-y-2">
          <ProductPicker
            placeholder="Add a product: name, SKU or barcode…"
            exclude={fields.map((f) => f.productId)}
            onPick={(p) => append({ productId: p.id, name: p.name, sku: p.sku, qty: 1 })}
          />
          <table className="w-full text-sm">
            <thead className="text-left text-gray-600">
              <tr className="border-b">
                <th className="py-2 font-medium">Product</th>
                <th className="py-2 text-right font-medium">On hand at {branch.code}</th>
                <th className="w-32 py-2 font-medium">Qty</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {fields.map((f, i) => (
                <tr key={f.id} className="border-b align-top">
                  <td className="py-2">
                    {f.name} <span className="font-mono text-xs text-gray-500">{f.sku}</span>
                  </td>
                  <OnHandCell code={branch.code} productId={f.productId} qty={lines[i]?.qty} />
                  <td className="py-2 pr-2">
                    <Input
                      type="number"
                      min={1}
                      aria-label={`Quantity of ${f.name}`}
                      aria-invalid={!!errors.lines?.[i]?.qty}
                      className="text-right tabular-nums"
                      {...form.register(`lines.${i}.qty`, { valueAsNumber: true })}
                    />
                    {errors.lines?.[i]?.qty && (
                      <p className="text-xs text-red-600">{errors.lines[i].qty.message}</p>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => remove(i)}
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
              {fields.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-gray-500">
                    No lines yet: search for a product above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {errors.lines?.message && <p className="text-sm text-red-600">{errors.lines.message}</p>}
        </div>

        <FormField id="note" label="Note" error={errors.note?.message}>
          <Textarea
            id="note"
            rows={2}
            placeholder="Optional: driver, vehicle, reason…"
            {...form.register('note')}
          />
        </FormField>

        {errors.root && <p className="text-sm text-red-600">{errors.root.message}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!fields.length || isSubmitting} onClick={submit(true)}>
            {isSubmitting ? 'Working…' : 'Save and dispatch'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!fields.length || isSubmitting}
            onClick={submit(false)}
          >
            Save (dispatch later)
          </Button>
          <Button variant="ghost" asChild>
            <Link to={transferPath(branch.code)}>Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}

/** On hand HERE, and a warning (not a block) when the quantity is more: stock is checked again at dispatch. */
function OnHandCell({ code, productId, qty }: { code: string; productId: string; qty?: number }) {
  const row = useQuery({
    queryKey: qk.inventoryRow(code, productId),
    queryFn: () => http.get<{ row: InventoryRowDto }>(`/b/${code}/inventory/${productId}`).then((r) => r.row),
    staleTime: 10_000,
  });
  const onHand = row.data?.quantity;
  return (
    <td className="py-2 text-right tabular-nums">
      {onHand ?? '…'}
      {onHand !== undefined && (qty ?? 0) > onHand && (
        <p className="text-xs text-amber-700">More than on hand</p>
      )}
    </td>
  );
}
