import { useState } from 'react';
import { BPS, formatBps, type Discount } from '@shopstock/shared';
import { MoneyInput } from '@/components/MoneyInput';
import { PercentInput } from '@/components/PercentInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useActor } from '@/features/auth/useActor';
import { cn } from '@/lib/utils';
import { useCart, usePosUi } from './cartStore';

/** F7 (selected line) / F8 (whole cart). The cap is shown here; the server enforces it anyway. */
export function DiscountDialog({ onClosed }: { onClosed: () => void }) {
  const target = usePosUi((s) => s.discountFor);
  const close = () => {
    usePosUi.getState().setDiscountFor(null);
    onClosed();
  };
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {target !== null && <DiscountForm key={String(target)} target={target} onDone={close} />}
      </DialogContent>
    </Dialog>
  );
}

function DiscountForm({ target, onDone }: { target: 'cart' | number; onDone: () => void }) {
  const { settings } = useActor();
  const line = useCart((s) => (target === 'cart' ? null : s.lines[target]));
  const current = useCart((s) => (target === 'cart' ? s.cartDiscount : (s.lines[target]?.discount ?? null)));
  const [type, setType] = useState<Discount['type']>(current?.type ?? 'percent');
  const [bps, setBps] = useState<number | null>(current?.type === 'percent' ? current.bps : null);
  const [amount, setAmount] = useState<number | null>(current?.type === 'amount' ? current.amount : null);
  const unlimited = settings.discountCapBps >= BPS;

  const apply = (d: Discount | null) => {
    const cart = useCart.getState();
    if (target === 'cart') cart.setCartDiscount(d);
    else cart.setLineDiscount(target, d);
    onDone();
  };
  const value: Discount | null =
    type === 'percent' ? (bps === null ? null : { type, bps }) : amount === null ? null : { type, amount };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value) apply(value);
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>
          {target === 'cart' ? 'Cart discount (F8)' : `Discount: ${line?.name ?? ''} (F7)`}
        </DialogTitle>
      </DialogHeader>
      <div className="flex gap-2" role="radiogroup" aria-label="Discount type">
        {(['percent', 'amount'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            onClick={() => setType(t)}
            className={cn(
              'flex-1 rounded-md border px-3 py-2 text-sm',
              type === t && 'border-gray-900 bg-gray-900 text-white',
            )}
          >
            {t === 'percent' ? 'Percent %' : 'Amount'}
          </button>
        ))}
      </div>
      {type === 'percent' ? (
        <PercentInput id="disc" autoFocus value={bps} onChange={setBps} />
      ) : (
        <MoneyInput id="disc" autoFocus value={amount} onChange={setAmount} />
      )}
      <p className="text-sm text-gray-600">
        {unlimited ? 'No limit for your role.' : `Your limit: ${formatBps(settings.discountCapBps)}`}
      </p>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => apply(null)} disabled={!current}>
          Remove discount
        </Button>
        <Button type="submit" disabled={!value}>
          Apply (Enter)
        </Button>
      </DialogFooter>
    </form>
  );
}
