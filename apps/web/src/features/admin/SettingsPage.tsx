import type { ReactNode } from 'react';
import { Controller, useForm, useWatch, type DefaultValues, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  RECEIPT_FORMATS,
  settingsFieldsSchema as f,
  type ShopSettingsDto,
  type UpdateSettingsInput,
} from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { FormField } from '@/components/FormField';
import { PercentInput } from '@/components/PercentInput';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { applyServerErrors } from '@/lib/formErrors';

/** A PercentInput gives null while the text is invalid: say so in words, not "expected number". */
const pct = (maxPct: number) =>
  z
    .number({ error: `Enter a percentage from 0 to ${maxPct}` })
    .int()
    .min(0)
    .max(maxPct * 100);

const ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Asia/Dhaka', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'UTC']; // old browsers
  }
})();

export function SettingsPage() {
  const settings = useQuery({
    queryKey: qk.settings,
    queryFn: () => http.get<{ settings: ShopSettingsDto }>('/settings/full').then((r) => r.settings),
  });
  if (settings.isPending) return <p className="text-gray-500">Loading…</p>;
  if (!settings.data) return <p className="text-red-600">Could not load settings.</p>;
  const s = settings.data;

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <ShopSection s={s} />
      <TaxSection s={s} />
      <DiscountSection s={s} />
      <ReturnsSection s={s} />
      <ReceiptSection s={s} />
      <Card>
        <CardHeader>
          <CardTitle>Currency</CardTitle>
          <CardDescription>Fixed at setup: every stored amount depends on it.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {s.currency.code} · {s.currency.symbol} · {s.currency.minorUnits} decimals
        </CardContent>
      </Card>
    </div>
  );
}

/** PATCH only what changed; then refresh /me so the POS sees new caps and tax at once. */
function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateSettingsInput) =>
      http.patch<{ full: ShopSettingsDto }>('/settings', patch).then((r) => r.full),
    onSuccess: async (full) => {
      qc.setQueryData(qk.settings, full);
      await qc.invalidateQueries({ queryKey: qk.me });
      toast.success('Settings saved');
    },
  });
}

/** One card = one small form with its own Save button. */
function Section<T extends FieldValues>(props: {
  title: string;
  description?: string;
  schema: z.ZodType<T, T>;
  defaults: T;
  toPatch: (changed: Partial<T>) => UpdateSettingsInput;
  children: (form: ReturnType<typeof useForm<T>>) => ReactNode;
}) {
  const save = useSaveSettings();
  const form = useForm<T>({
    resolver: zodResolver(props.schema),
    defaultValues: props.defaults as DefaultValues<T>,
  });
  const onSubmit = form.handleSubmit(async (v) => {
    const changed = Object.fromEntries(
      Object.entries(v).filter(([k, val]) => JSON.stringify(val) !== JSON.stringify(props.defaults[k])),
    ) as Partial<T>;
    if (Object.keys(changed).length === 0) return void toast.info('Nothing changed');
    try {
      await save.mutateAsync(props.toPatch(changed));
      form.reset(v); // the saved values are the new baseline
    } catch (e) {
      applyServerErrors(e, form.setError);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        {props.description && <CardDescription>{props.description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {props.children(form)}
          {form.formState.errors.root && (
            <p className="text-sm text-red-600">{form.formState.errors.root.message}</p>
          )}
          <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
            {form.formState.isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const shopSchema = f.pick({ shopName: true, timezone: true });
function ShopSection({ s }: { s: ShopSettingsDto }) {
  return (
    <Section
      title="Shop"
      schema={shopSchema}
      defaults={{ shopName: s.shopName, timezone: s.timezone }}
      toPatch={(c) => c}
    >
      {({ register, formState: { errors } }) => (
        <>
          <FormField id="shopName" label="Shop name" error={errors.shopName?.message}>
            <Input id="shopName" {...register('shopName')} />
          </FormField>
          <FormField
            id="timezone"
            label="Timezone"
            error={errors.timezone?.message}
            hint="Decides which day a sale belongs to. Changing it affects new sales only."
          >
            <select
              id="timezone"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              {...register('timezone')}
            >
              {(ZONES.includes(s.timezone) ? ZONES : [s.timezone, ...ZONES]).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </FormField>
        </>
      )}
    </Section>
  );
}

const taxSchema = z.object({ taxRateBps: pct(50), taxLabel: f.shape.taxLabel });
function TaxSection({ s }: { s: ShopSettingsDto }) {
  return (
    <Section
      title="Tax"
      description="Applies to new sales only."
      schema={taxSchema}
      defaults={{ taxRateBps: s.taxRateBps, taxLabel: s.taxLabel }}
      toPatch={(c) => c}
    >
      {({ register, control, formState: { errors } }) => (
        <div className="grid grid-cols-2 gap-3">
          <FormField id="tax" label="VAT rate" error={errors.taxRateBps?.message} hint="0 for no VAT">
            <Controller
              control={control}
              name="taxRateBps"
              render={({ field }) => (
                <PercentInput id="tax" max={50} value={field.value} onChange={field.onChange} />
              )}
            />
          </FormField>
          <FormField id="taxLabel" label="Label on receipts" error={errors.taxLabel?.message}>
            <Input id="taxLabel" {...register('taxLabel')} />
          </FormField>
        </div>
      )}
    </Section>
  );
}

const capsSchema = z.object({ cashier: pct(100), manager: pct(100) });
function DiscountSection({ s }: { s: ShopSettingsDto }) {
  return (
    <Section
      title="Discount limits"
      description="The most each role may discount at the counter. The owner has no limit."
      schema={capsSchema}
      defaults={s.discountCapsBps}
      toPatch={(c) => ({ discountCapsBps: c })} // only the changed cap: the API flattens it
    >
      {({ control, formState: { errors } }) => (
        <div className="grid grid-cols-2 gap-3">
          {(['cashier', 'manager'] as const).map((role) => (
            <FormField key={role} id={`cap-${role}`} label={`${role} cap`} error={errors[role]?.message}>
              <Controller
                control={control}
                name={role}
                render={({ field }) => (
                  <PercentInput id={`cap-${role}`} value={field.value} onChange={field.onChange} />
                )}
              />
            </FormField>
          ))}
        </div>
      )}
    </Section>
  );
}

const returnsSchema = z.object({
  returnWindowDays: z.number({ error: 'Enter a number of days' }).int().min(0).max(365),
});
function ReturnsSection({ s }: { s: ShopSettingsDto }) {
  return (
    <Section
      title="Returns"
      schema={returnsSchema}
      defaults={{ returnWindowDays: s.returnWindowDays }}
      toPatch={(c) => c}
    >
      {({ register, formState: { errors } }) => (
        <FormField
          id="window"
          label="Return window (days)"
          error={errors.returnWindowDays?.message}
          hint="0 = no returns"
        >
          <Input
            id="window"
            type="number"
            min={0}
            max={365}
            className="w-32"
            {...register('returnWindowDays', { valueAsNumber: true })}
          />
        </FormField>
      )}
    </Section>
  );
}

const receiptSchema = f.pick({ receiptFormat: true, invoiceFooter: true });
function ReceiptSection({ s }: { s: ShopSettingsDto }) {
  return (
    <Section
      title="Receipts"
      schema={receiptSchema}
      defaults={{ receiptFormat: s.receiptFormat, invoiceFooter: s.invoiceFooter }}
      toPatch={(c) => c}
    >
      {({ register, control, formState: { errors } }) => (
        <>
          <FormField id="format" label="Format" error={errors.receiptFormat?.message}>
            <Controller
              control={control}
              name="receiptFormat"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="format" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECEIPT_FORMATS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r === '80mm' ? '80 mm thermal' : 'A4 page'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FooterField control={control} register={register} error={errors.invoiceFooter?.message} />
        </>
      )}
    </Section>
  );
}

type ReceiptForm = z.infer<typeof receiptSchema>;
function FooterField(props: {
  control: ReturnType<typeof useForm<ReceiptForm>>['control'];
  register: ReturnType<typeof useForm<ReceiptForm>>['register'];
  error?: string;
}) {
  const footer = useWatch({ control: props.control, name: 'invoiceFooter' }) ?? '';
  return (
    <FormField id="footer" label="Receipt footer" error={props.error} hint={`${footer.length}/300`}>
      <Textarea id="footer" rows={3} maxLength={300} {...props.register('invoiceFooter')} />
    </FormField>
  );
}
