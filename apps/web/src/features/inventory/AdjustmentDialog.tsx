import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  ADJUSTMENT_REASONS,
  LIMITS,
  REASON_SIGN,
  moneySchema,
  objectIdSchema,
  type AdjustmentReason,
  type AdjustmentResultDto,
} from '@shopstock/shared';
import { http } from '@/api/client';
import { MoneyInput } from '@/components/MoneyInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useBranch } from '@/features/branch/useBranch';
import { ProductPicker } from '@/features/catalog/ProductPicker';
import { applyLineErrors } from '@/lib/formErrors';
import { useInvalidateStock } from './hooks';

const REASON_LABEL: Record<AdjustmentReason, string> = {
  opening_balance: 'Opening stock (in)',
  found: 'Found (in)',
  damaged: 'Damaged (out)',
  expired: 'Expired (out)',
  lost: 'Lost / stolen (out)',
  count_correction: 'Count correction (+ or −)',
};

/**
 * What the PERSON types: a positive quantity (the reason decides the sign), except for
 * count_correction, which takes a signed number. Mapped to the API's adjustmentSchema on submit.
 */
const formSchema = z
  .object({
    reason: z.enum(ADJUSTMENT_REASONS),
    note: z.string().max(500),
    lines: z
      .array(
        z.object({
          productId: objectIdSchema,
          name: z.string(),
          qty: z.number({ error: 'Enter a whole number' }).int('Whole units only'),
          unitCost: moneySchema.optional(),
        }),
      )
      .min(1, 'Add at least one product')
      .max(LIMITS.adjustmentLines),
  })
  .superRefine((v, ctx) => {
    v.lines.forEach((l, i) => {
      const signed = v.reason === 'count_correction';
      if (signed ? l.qty === 0 : l.qty < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', i, 'qty'],
          message: signed ? 'Must not be 0' : 'At least 1',
        });
      }
      if (Math.abs(l.qty) > LIMITS.maxDocQty) {
        ctx.addIssue({ code: 'custom', path: ['lines', i, 'qty'], message: 'Too large' });
      }
      if (v.reason === 'opening_balance' && l.unitCost === undefined) {
        ctx.addIssue({ code: 'custom', path: ['lines', i, 'unitCost'], message: 'Enter the unit cost' });
      }
    });
  });
type FormValues = z.infer<typeof formSchema>;

export function AdjustmentDialog({ onClose }: { onClose: () => void }) {
  const branch = useBranch();
  const invalidate = useInvalidateStock(branch.code);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { reason: 'opening_balance', note: '', lines: [] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  const reason = useWatch({ control: form.control, name: 'reason' });
  const sign = REASON_SIGN[reason]; // shared with the API: which sign this reason allows
  const costMatters = sign >= 0; // only stock coming IN carries a cost (out uses the current average)
  const { errors } = form.formState;

  const save = useMutation({
    mutationFn: (v: FormValues) =>
      http.post<AdjustmentResultDto>(`/b/${branch.code}/adjustments`, {
        reason: v.reason,
        note: v.note,
        lines: v.lines.map((l) => ({
          productId: l.productId,
          qtyChange: sign === -1 ? -l.qty : l.qty,
          ...(costMatters && l.unitCost !== undefined && { unitCost: l.unitCost }),
        })),
      }),
    onSuccess: async ({ refNo }) => {
      await invalidate();
      toast.success(`Saved ${refNo}`);
      onClose();
    },
  });

  const onSubmit = form.handleSubmit((v) =>
    save.mutateAsync(v).catch((err) => {
      const placed = applyLineErrors(
        err,
        v.lines.map((l) => l.productId),
        (i, field, message) => form.setError(`lines.${i}.${field}`, { message }),
      );
      if (!placed) form.setError('root', { message: (err as Error).message });
    }),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Adjust stock · {branch.code}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Reason</span>
            <select className="h-9 w-full rounded-md border bg-transparent px-3" {...form.register('reason')}>
              {ADJUSTMENT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]}
                </option>
              ))}
            </select>
          </label>

          <ProductPicker
            exclude={fields.map((f) => f.productId)}
            onPick={(p) => append({ productId: p.id, name: p.name, qty: 1, unitCost: undefined })}
          />

          {fields.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1 font-normal">Product</th>
                  <th className="w-32 py-1 font-normal">
                    Qty {sign === -1 ? '(out)' : sign === 1 ? '(in)' : '(+ in, − out)'}
                  </th>
                  {costMatters && <th className="w-40 py-1 font-normal">Unit cost</th>}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => {
                  const lineErr = errors.lines?.[i];
                  return (
                    // field.id, never the index: removing a line must not shift typed values
                    <tr key={f.id} className="align-top">
                      <td className="py-1 pr-2">{f.name}</td>
                      <td className="py-1 pr-2">
                        <Input
                          type="number"
                          aria-label={`Quantity for ${f.name}`}
                          aria-invalid={!!lineErr?.qty}
                          {...form.register(`lines.${i}.qty`, { valueAsNumber: true })}
                        />
                        {lineErr?.qty && <p className="mt-1 text-xs text-red-600">{lineErr.qty.message}</p>}
                      </td>
                      {costMatters && (
                        <td className="py-1 pr-2">
                          <Controller
                            control={form.control}
                            name={`lines.${i}.unitCost`}
                            render={({ field }) => (
                              <MoneyInput
                                aria-invalid={!!lineErr?.unitCost}
                                value={field.value ?? null}
                                onChange={(v) => field.onChange(v ?? undefined)}
                              />
                            )}
                          />
                          {lineErr?.unitCost && (
                            <p className="mt-1 text-xs text-red-600">{lineErr.unitCost.message}</p>
                          )}
                        </td>
                      )}
                      <td className="py-1">
                        <Button
                          variant="ghost"
                          size="icon"
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
              </tbody>
            </table>
          )}
          {reason === 'found' && (
            <p className="text-xs text-gray-500">Leave the cost empty to keep the current average cost.</p>
          )}

          <Textarea placeholder="Note (optional)" maxLength={500} {...form.register('note')} />
          {errors.lines?.root && <p className="text-sm text-red-600">{errors.lines.root.message}</p>}
          {errors.root && <p className="text-sm text-red-600">{errors.root.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!fields.length || form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving…' : 'Save adjustment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
