import { useState } from 'react';
import type { PaymentMethod } from '@shopstock/shared';
import { MoneyInput } from '@/components/MoneyInput';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useActor } from '@/features/auth/useActor';
import { cn } from '@/lib/utils';
import { useFormat } from '@/lib/useFormat';
import { usePosUi } from './cartStore';
import { useCompleteSale } from './useCompleteSale';
import { usePricedCart } from './usePricedCart';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'mobile', label: 'Mobile' },
];

/** F9. Enter completes. Card/mobile are charged exactly the total; only cash gives change. */
export function PayDialog({ onClosed }: { onClosed: () => void }) {
  const open = usePosUi((s) => s.payOpen);
  const close = () => {
    usePosUi.getState().setPayOpen(false);
    onClosed();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>{open && <PayForm />}</DialogContent>
    </Dialog>
  );
}

function PayForm() {
  const { settings } = useActor();
  const { money } = useFormat();
  const { priced, violations } = usePricedCart();
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [tendered, setTendered] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const complete = useCompleteSale();

  const total = priced.total;
  const paid = method === 'cash' ? (tendered ?? 0) : total;
  const change = Math.max(0, paid - total);
  const valid = violations.length === 0 && priced.lines.length > 0 && (method !== 'cash' || paid >= total);

  // QuickCash: Exact, then the next round amounts above the total, in minor units (never floats).
  const unit = 10 ** settings.currency.minorUnits; // ৳1 in minor units
  const roundUp = (amount: number, step: number) => Math.ceil(amount / step) * step;
  const quick = [
    ...new Set([total, roundUp(total, 100 * unit), roundUp(total, 500 * unit), roundUp(total, 1000 * unit)]),
  ];

  const submit = () =>
    complete.mutate({
      payments: [{ method, amount: paid, ...(reference.trim() && { reference: reference.trim() }) }],
      expectedTotal: total, // FR-PRC-06: the server answers PRICE_CHANGED if it disagrees
    });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !complete.isPending) submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Payment</DialogTitle>
      </DialogHeader>
      <p className="text-center text-4xl font-bold tabular-nums" data-testid="pay-total">
        {money(total)}
      </p>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment method">
        {METHODS.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={method === m.value}
            onClick={() => setMethod(m.value)}
            className={cn(
              'rounded-md border py-2',
              method === m.value && 'border-gray-900 bg-gray-900 text-white',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      {method === 'cash' ? (
        <>
          <MoneyInput
            id="tendered"
            autoFocus
            value={tendered}
            onChange={setTendered}
            placeholder="Cash received"
            aria-label="Cash received"
          />
          <div className="flex flex-wrap gap-2">
            {quick.map((amount, i) => (
              <Button
                key={amount}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTendered(amount)}
              >
                {i === 0 ? 'Exact' : money(amount)}
              </Button>
            ))}
          </div>
          <p className="text-xl">
            Change:{' '}
            <b className="tabular-nums" data-testid="change">
              {money(change)}
            </b>
          </p>
        </>
      ) : (
        <Input
          autoFocus
          placeholder="Reference (last 4 digits / transaction id)"
          value={reference}
          maxLength={60}
          onChange={(e) => setReference(e.target.value)}
        />
      )}
      <Button type="submit" className="h-12 w-full text-lg" disabled={!valid || complete.isPending}>
        {complete.isPending ? 'Completing…' : 'Complete sale (Enter)'}
      </Button>
      {complete.isUncertain && (
        <Alert>
          <AlertTitle>Connection lost</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              The sale may or may not have gone through. <b>Retry is safe</b>: it can't charge twice.
            </p>
            <Button type="button" onClick={() => complete.retry()} disabled={complete.isPending}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </form>
  );
}
