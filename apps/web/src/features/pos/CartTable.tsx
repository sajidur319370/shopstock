import { formatBps, type Discount } from '@shopstock/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useFormat } from '@/lib/useFormat';
import { useCart, usePosUi } from './cartStore';
import { usePricedCart } from './usePricedCart';

export function CartTable({ onChanged }: { onChanged: () => void }) {
  const { money } = useFormat();
  const lines = useCart((s) => s.lines);
  const selected = useCart((s) => s.selected);
  const { select, setQty, remove } = useCart.getState();
  const { priced, violations } = usePricedCart();
  const overCap = new Set(violations.map((v) => v.productId));
  const discountLabel = (d: Discount | null) =>
    !d ? '—' : d.type === 'percent' ? formatBps(d.bps) : money(d.amount);

  if (lines.length === 0) {
    return (
      <div className="grid place-items-center rounded-md border border-dashed text-gray-500">
        Scan a barcode or type a name to start a sale.
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-3 py-2 font-normal">Item</th>
            <th className="px-3 py-2 text-right font-normal">Price</th>
            <th className="w-24 px-3 py-2 font-normal">Qty</th>
            <th className="px-3 py-2 text-right font-normal">Disc</th>
            <th className="px-3 py-2 text-right font-normal">Total</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const short = l.qty > l.onHand;
            return (
              <tr
                key={l.productId}
                onClick={() => select(i)}
                aria-selected={i === selected}
                className={cn(
                  'cursor-pointer border-t',
                  i === selected && 'bg-blue-50',
                  short && !l.problem && 'bg-amber-50',
                  l.problem && 'bg-red-50',
                )}
              >
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {i === selected && <span aria-hidden>▸ </span>}
                    {l.name}
                  </div>
                  {l.problem ? (
                    <div className="text-xs font-medium text-red-700">{l.problem}</div>
                  ) : short ? (
                    <div className="text-xs text-amber-800">Only {l.onHand} in stock</div>
                  ) : null}
                  {overCap.has(l.productId) && (
                    <div className="text-xs font-medium text-red-700">Discount over your limit</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.unitPrice)}</td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min={1}
                    aria-label={`Quantity of ${l.name}`}
                    className="h-8 w-20 tabular-nums"
                    value={l.qty}
                    onChange={(e) => setQty(i, Number(e.target.value))}
                    onKeyDown={(e) => e.key === 'Enter' && onChanged()}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    className="underline decoration-dotted"
                    onClick={(e) => {
                      e.stopPropagation();
                      select(i);
                      usePosUi.getState().setDiscountFor(i);
                    }}
                  >
                    {discountLabel(l.discount)}
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {money(priced.lines[i]?.total ?? 0)}
                </td>
                <td className="px-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${l.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(i);
                      onChanged();
                    }}
                  >
                    ✕
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t px-3 py-2 text-xs text-gray-500">
        Empty search box: ↑ ↓ select · + − qty · Del remove · F7 line discount · F8 cart discount · F9 pay · ?
        help
      </p>
    </div>
  );
}
