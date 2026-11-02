import { useState, type FormEvent } from 'react';
import { Controller, useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate } from 'react-router';
import type { z } from 'zod';
import { setupSchema, type SetupInput } from '@shopstock/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/FormField';
import { PercentInput } from '@/components/PercentInput';
import { applyServerErrors } from '@/lib/formErrors';
import { AuthCard } from '../auth/AuthCard';
import { useSetup } from '../auth/useAuthActions';
import { useSetupStatus } from '../auth/useMe';

/** What the form holds (defaults like branch.address are still optional) vs. what the schema outputs. */
type SetupForm = z.input<typeof setupSchema>;

const STEPS: { title: string; fields: FieldPath<SetupForm>[] }[] = [
  {
    title: 'Your shop',
    fields: ['shopName', 'currency.code', 'currency.symbol', 'currency.minorUnits', 'timezone', 'taxRateBps'],
  },
  { title: 'Owner account', fields: ['owner.name', 'owner.email', 'owner.password'] },
  { title: 'First branch', fields: ['branch.code', 'branch.name', 'branch.address', 'branch.phone'] },
];

export function SetupPage() {
  const status = useSetupStatus();
  const setup = useSetup();
  const [step, setStep] = useState(0);
  const [token, setToken] = useState('');
  const form = useForm<SetupForm, unknown, SetupInput>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      currency: { code: 'BDT', symbol: '৳', minorUnits: 2 },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      taxRateBps: 0,
    },
  });
  const {
    register,
    handleSubmit,
    trigger,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = form;

  // Already set up → login. But not while OUR setup is finishing: onSuccess marks setup done before it
  // has loaded /me and navigated to '/', and this redirect would flash the login page in between.
  const finishing = setup.isPending || setup.isSuccess;
  if (status.data && !status.data.needsSetup && !finishing) return <Navigate to="/login" replace />;

  const next = async () => {
    if (await trigger(STEPS[step]!.fields)) setStep((s) => s + 1);
  };
  const tokenRequired = !!status.data?.tokenRequired;
  const submit = handleSubmit((v) =>
    setup
      .mutateAsync({ input: v, token: tokenRequired ? token.trim() : undefined })
      .catch((e) => applyServerErrors(e, setError)),
  );
  // Enter on steps 1–2 means "Next", not "submit the whole wizard".
  const onSubmit = (e: FormEvent) => {
    if (step < STEPS.length - 1) {
      e.preventDefault();
      void next();
      return;
    }
    void submit(e);
  };

  return (
    <AuthCard title={`Set up your shop · ${step + 1}/3 ${STEPS[step]!.title}`}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {step === 0 && (
          <>
            <FormField id="shopName" label="Shop name" error={errors.shopName?.message}>
              <Input id="shopName" autoFocus {...register('shopName')} />
            </FormField>
            <div className="grid grid-cols-3 gap-2">
              <FormField id="cc" label="Currency" error={errors.currency?.code?.message}>
                <Input id="cc" {...register('currency.code')} />
              </FormField>
              <FormField id="cs" label="Symbol" error={errors.currency?.symbol?.message}>
                <Input id="cs" {...register('currency.symbol')} />
              </FormField>
              <FormField
                id="cm"
                label="Decimals"
                hint="BDT/USD: 2"
                error={errors.currency?.minorUnits?.message}
              >
                <Input id="cm" type="number" {...register('currency.minorUnits', { valueAsNumber: true })} />
              </FormField>
            </div>
            <FormField
              id="tz"
              label="Timezone"
              error={errors.timezone?.message}
              hint="Used for 'today' and daily reports"
            >
              <Input id="tz" {...register('timezone')} />
            </FormField>
            <FormField
              id="tax"
              label="VAT rate"
              error={errors.taxRateBps && 'Enter a percentage from 0 to 50'}
              hint="e.g. 5 or 7.5. Use 0 for no VAT. You can change it later in Settings."
            >
              <Controller
                control={control}
                name="taxRateBps"
                render={({ field }) => (
                  <PercentInput id="tax" max={50} value={field.value ?? null} onChange={field.onChange} />
                )}
              />
            </FormField>
          </>
        )}
        {step === 1 && (
          <>
            <FormField id="on" label="Your name" error={errors.owner?.name?.message}>
              <Input id="on" autoFocus {...register('owner.name')} />
            </FormField>
            <FormField id="oe" label="Email" error={errors.owner?.email?.message}>
              <Input id="oe" type="email" autoComplete="username" {...register('owner.email')} />
            </FormField>
            <FormField
              id="op"
              label="Password"
              error={errors.owner?.password?.message}
              hint="8+ characters, a letter and a digit"
            >
              <Input id="op" type="password" autoComplete="new-password" {...register('owner.password')} />
            </FormField>
          </>
        )}
        {step === 2 && (
          <>
            <FormField
              id="bc"
              label="Branch code"
              error={errors.branch?.code?.message}
              hint="Short and permanent: used in URLs and invoice numbers (GUL-000001)"
            >
              <Input id="bc" autoFocus className="uppercase" {...register('branch.code')} />
            </FormField>
            <FormField id="bn" label="Branch name" error={errors.branch?.name?.message}>
              <Input id="bn" {...register('branch.name')} />
            </FormField>
            <FormField id="ba" label="Address" error={errors.branch?.address?.message}>
              <Input id="ba" {...register('branch.address')} />
            </FormField>
            <FormField id="bp" label="Phone" error={errors.branch?.phone?.message}>
              <Input id="bp" {...register('branch.phone')} />
            </FormField>
            {tokenRequired && (
              // Not part of the shop data: it goes in a header. The value is SETUP_TOKEN from the server's env.
              <FormField id="st" label="Setup token">
                <Input
                  id="st"
                  type="password"
                  autoComplete="off"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </FormField>
            )}
          </>
        )}
        {errors.root && <p className="text-sm text-red-600">{errors.root.message}</p>}
        <div className="flex justify-between">
          <Button type="button" variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
          {/* "Next" is a submit button too, so Enter works on every step (onSubmit routes steps 1–2 to next()).
              Distinct keys: otherwise React reuses the same <button> while the click is still being
              handled, and the wizard submits itself on arrival at step 3. */}
          {step < STEPS.length - 1 ? (
            <Button key="next" type="submit">
              Next
            </Button>
          ) : (
            <Button key="submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create shop'}
            </Button>
          )}
        </div>
      </form>
    </AuthCard>
  );
}
