import { useState } from 'react';
import { formatBps } from '@shopstock/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { useFormat } from '@/lib/useFormat';
import { useCart, usePosUi } from './cartStore';
import { usePricedCart } from './usePricedCart';

export function TotalsPanel({ onDone }: { onDone: () => void }) {
  const branch = useBranch();
  const { settings } = useActor();
  const { money } = useFormat();
  const { priced, violations } = usePricedCart();
  const lines = useCart((s) => s.lines);
  const [clearing, setClearing] = useState(false);
  const empty = lines.length === 0;
  const cartOver = violations.some((v) => v.productId === null);
  const hasProblems = lines.some((l) => l.problem);

  return (
    <aside className="flex flex-col gap-3 rounded-md border p-4">
      <dl className="space-y-1 text-sm">
        <Row label="Items" value={String(priced.itemCount)} />
        <Row label="Subtotal" value={money(priced.subtotal)} />
        {priced.discount > 0 && <Row label="Discount" value={`−${money(priced.discount)}`} />}
        {settings.taxRateBps > 0 && (
          <Row label={`${settings.taxLabel} ${formatBps(settings.taxRateBps)}`} value={money(priced.tax)} />
        )}
      </dl>
      <div className="flex items-baseline justify-between border-t pt-3">
        <span className="text-sm font-medium">TOTAL</span>
        <span className="text-3xl font-bold tabular-nums" data-testid="pos-total">
          {money(priced.total)}
        </span>
      </div>
      {violations.length > 0 && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-800">
          {cartOver ? 'The total discount is' : 'A line discount is'} over your{' '}
          {formatBps(settings.discountCapBps)} limit. Lower it to continue.
        </p>
      )}
      <div className="mt-auto grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={empty} onClick={() => usePosUi.getState().setDiscountFor('cart')}>
          Discount (F8)
        </Button>
        <Button
          className="h-11 text-base"
          disabled={empty || violations.length > 0 || hasProblems}
          onClick={() => usePosUi.getState().setPayOpen(true)}
        >
          Pay (F9)
        </Button>
        <Button variant="ghost" className="col-span-2" disabled={empty} onClick={() => setClearing(true)}>
          Clear cart
        </Button>
      </div>
      <ConfirmDialog
        open={clearing}
        onOpenChange={(o) => {
          setClearing(o);
          if (!o) onDone();
        }}
        title="Clear the cart?"
        description="All items are removed and a new sale starts."
        confirmLabel="Clear"
        destructive
        onConfirm={() => {
          useCart.getState().reset(branch.code); // a new sale → a new clientSaleId
          setClearing(false);
          onDone();
        }}
      />
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-600">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
