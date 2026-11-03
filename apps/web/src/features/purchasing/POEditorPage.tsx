import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { LIMITS, objectIdSchema, toBusinessDate, type PODto } from '@shopstock/shared';
import { ApiError, http } from '@/api/client';
import { qk } from '@/api/keys';
import { FormField } from '@/components/FormField';
import { MoneyInput } from '@/components/MoneyInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { ProductPicker } from '@/features/catalog/ProductPicker';
import { applyServerErrors } from '@/lib/formErrors';
import { useFormat } from '@/lib/useFormat';
import { cn } from '@/lib/utils';
import { FromLowStock } from './FromLowStock';
import { poPath, useAllSuppliers, usePO } from './hooks';

/**
 * What the PERSON edits: lines carry name/sku for display, the cost may be empty while typing, and
 * the expected date is '' when none. Mapped to createPOSchema / updatePOSchema on submit.
 */
const formSchema = z.object({
  supplierId: z.string().min(1, 'Choose a supplier'),
  lines: z
    .array(
      z.object({
        productId: objectIdSchema,
        name: z.string(),
        sku: z.string(),
        orderedQty: z
          .number({ error: 'Enter a quantity' })
          .int('Whole units only')
          .min(1, 'At least 1')
          .max(LIMITS.maxDocQty, 'Too large'),
        unitCost: z
          .number()
          .int()
          .min(0)
          .max(LIMITS.maxMoney)
          .nullable()
          .refine((v) => v !== null, 'Enter a cost, e.g. 390.00'),
      }),
    )
    .min(1, 'Add at least one product')
    .max(LIMITS.poLines),
  expectedDate: z.string(),
  notes: z.string().max(1000),
});
type FormIn = z.input<typeof formSchema>; // unitCost may be null while typing
type FormOut = z.output<typeof formSchema>; // …and is a number once valid

const fromDto = (po: PODto, activeIds: Set<string>): FormIn => ({
  // An old draft whose supplier was deactivated must pick a new one (FR-SUP-02).
  supplierId: activeIds.has(po.supplierId) ? po.supplierId : '',
  lines: po.items.map((i) => ({
    productId: i.productId,
    name: i.name,
    sku: i.sku,
    orderedQty: i.orderedQty,
    unitCost: i.unitCost,
  })),
  expectedDate: po.expectedDate ?? '',
  notes: po.notes,
});

/** /b/:code/purchase-orders/new[?from=low-stock] and /b/:code/purchase-orders/:id/edit (po:manage). */
export function POEditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const branch = useBranch();
  const po = usePO(id ?? '');
  const suppliers = useAllSuppliers('true');

  if (!id && params.get('from') === 'low-stock') return <FromLowStock />;
  if (id && po.isError) return <p className="text-red-600">Purchase order not found.</p>;
  if ((id && !po.data) || !suppliers.data) return <Skeleton className="h-96 w-full" />;
  // Only drafts are editable: anything else goes to its detail page (the server would say 409 anyway).
  if (po.data && po.data.status !== 'draft') return <Navigate to={poPath(branch.code, po.data.id)} replace />;
  return <POEditor key={po.data?.id ?? 'new'} initial={po.data} />;
}

function POEditor({ initial }: { initial?: PODto }) {
  const branch = useBranch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { settings } = useActor();
  const { money } = useFormat();
  const suppliers = useAllSuppliers('true').data ?? [];
  const today = toBusinessDate(new Date(), settings.timezone); // the SHOP's today, like the server
  const supplierWasDeactivated = !!initial && !suppliers.some((s) => s.id === initial.supplierId);

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(formSchema),
    defaultValues: initial
      ? fromDto(initial, new Set(suppliers.map((s) => s.id)))
      : { supplierId: '', lines: [], expectedDate: '', notes: '' },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  const lines = useWatch({ control: form.control, name: 'lines' });
  const lineTotal = (i: number) => (lines[i]?.orderedQty || 0) * (lines[i]?.unitCost ?? 0); // integers: exact
  const orderedValue = lines.reduce((s, _l, i) => s + lineTotal(i), 0);
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (v: FormOut) => {
      const body = {
        supplierId: v.supplierId,
        lines: v.lines.map((l) => ({
          productId: l.productId,
          orderedQty: l.orderedQty,
          unitCost: l.unitCost,
        })),
        expectedDate: v.expectedDate || null,
        notes: v.notes,
      };
      return initial
        ? http.patch<{ purchaseOrder: PODto }>(poPath(branch.code, initial.id), body)
        : http.post<{ purchaseOrder: PODto }>(poPath(branch.code), body);
    },
    onSuccess: ({ purchaseOrder }) => {
      qc.setQueryData(qk.po(branch.code, purchaseOrder.id), purchaseOrder);
      void qc.invalidateQueries({ queryKey: ['pos', branch.code] });
      toast.success(initial ? 'Draft saved' : `Draft ${purchaseOrder.poNumber} created`);
      navigate(poPath(branch.code, purchaseOrder.id)); // ordering is a separate, deliberate click there
    },
  });

  const onSubmit = form.handleSubmit((v) => {
    if (v.expectedDate && v.expectedDate < today) {
      form.setError('expectedDate', { message: 'The expected date cannot be in the past.' });
      return;
    }
    return save.mutateAsync(v).catch((err) => {
      if (err instanceof ApiError && err.code === 'INVALID_STATE' && initial) {
        toast.error(`${err.message} Someone changed this purchase order.`);
        navigate(poPath(branch.code, initial.id));
      } else if (err instanceof ApiError && err.code === 'PRODUCT_INACTIVE' && Array.isArray(err.details)) {
        for (const d of err.details as { productId: string }[]) {
          const i = v.lines.findIndex((l) => l.productId === d.productId);
          if (i >= 0) form.setError(`lines.${i}.productId`, { message: 'Archived: remove this line' });
        }
      } else {
        applyServerErrors(err, form.setError, {
          INVALID_SUPPLIER: 'supplierId',
          EXPECTED_DATE_PAST: 'expectedDate',
        });
      }
    });
  });

  return (
    <div className="max-w-5xl space-y-4">
      <h1 className="text-xl font-semibold">
        {initial ? `Edit draft ${initial.poNumber}` : `New purchase order · ${branch.code}`}
      </h1>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField
          id="supplierId"
          label="Supplier"
          error={errors.supplierId?.message}
          hint={
            supplierWasDeactivated
              ? `${initial!.supplierName} is inactive now: choose another supplier.`
              : undefined
          }
        >
          <select
            id="supplierId"
            className="h-9 w-full max-w-sm rounded-md border bg-transparent px-3 text-sm"
            {...form.register('supplierId')}
          >
            <option value="">Choose a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FormField>
        {suppliers.length === 0 && (
          <p className="text-sm text-gray-600">
            No active suppliers yet.{' '}
            <Link className="underline" to="/suppliers/new">
              Create one
            </Link>{' '}
            first.
          </p>
        )}

        <div className="space-y-2">
          <ProductPicker
            placeholder="Add a product: name, SKU or barcode…"
            exclude={fields.map((f) => f.productId)}
            onPick={(p) => append({ productId: p.id, name: p.name, sku: p.sku, orderedQty: 1, unitCost: 0 })}
          />
          <table className="w-full text-sm">
            <thead className="text-left text-gray-600">
              <tr className="border-b">
                <th className="py-2 font-medium">Product</th>
                <th className="w-28 py-2 font-medium">Qty</th>
                <th className="w-40 py-2 font-medium">Unit cost</th>
                <th className="py-2 text-right font-medium">Line total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {fields.map((f, i) => {
                const le = errors.lines?.[i];
                const zeroCost = lines[i]?.unitCost === 0;
                return (
                  <tr key={f.id} className="border-b align-top">
                    <td className="py-2">
                      {f.name} <span className="font-mono text-xs text-gray-500">{f.sku}</span>
                      {le?.productId && <p className="text-xs text-red-600">{le.productId.message}</p>}
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        min={1}
                        aria-label={`Quantity of ${f.name}`}
                        aria-invalid={!!le?.orderedQty}
                        className="text-right tabular-nums"
                        {...form.register(`lines.${i}.orderedQty`, { valueAsNumber: true })}
                      />
                      {le?.orderedQty && <p className="text-xs text-red-600">{le.orderedQty.message}</p>}
                    </td>
                    <td className="py-2 pr-2">
                      <div className={cn('rounded-md', zeroCost && 'ring-2 ring-amber-300')}>
                        <Controller
                          control={form.control}
                          name={`lines.${i}.unitCost`}
                          render={({ field }) => (
                            <MoneyInput
                              aria-invalid={!!le?.unitCost}
                              value={field.value ?? null}
                              onChange={field.onChange}
                            />
                          )}
                        />
                      </div>
                      {le?.unitCost ? (
                        <p className="text-xs text-red-600">{le.unitCost.message}</p>
                      ) : (
                        zeroCost && <p className="text-xs text-amber-700">Free goods? Check the cost.</p>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">{money(lineTotal(i))}</td>
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
                );
              })}
              {fields.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-gray-500">
                    No lines yet: search for a product above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {errors.lines?.root && <p className="text-sm text-red-600">{errors.lines.root.message}</p>}
          {errors.lines?.message && <p className="text-sm text-red-600">{errors.lines.message}</p>}
          <p className="text-right font-medium tabular-nums">Ordered value {money(orderedValue)}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <FormField
            id="expectedDate"
            label="Expected date"
            error={errors.expectedDate?.message}
            hint="Optional"
          >
            <Input id="expectedDate" type="date" min={today} {...form.register('expectedDate')} />
          </FormField>
          <FormField id="notes" label="Notes" error={errors.notes?.message}>
            <Textarea
              id="notes"
              rows={2}
              placeholder="Notes for the supplier (optional)"
              {...form.register('notes')}
            />
          </FormField>
        </div>

        {errors.root && <p className="text-sm text-red-600">{errors.root.message}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={!fields.length || form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving…' : 'Save draft'}
          </Button>
          <Button variant="ghost" asChild>
            <Link to={initial ? poPath(branch.code, initial.id) : poPath(branch.code)}>Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
