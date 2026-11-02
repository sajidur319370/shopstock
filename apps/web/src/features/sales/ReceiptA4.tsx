import { formatBps, formatMoney } from '@shopstock/shared';
import { METHOD_LABEL } from './hooks';
import { receiptTime, type ReceiptProps } from './receipt';

/** A4 invoice: the same stored data as a table. The cart discount is in "Discount", not spread per line. */
export function ReceiptA4({ sale, branch, settings, copy }: ReceiptProps) {
  const m = (v: number) => formatMoney(v, settings.currency);
  return (
    <article
      data-testid="receipt"
      className="mx-auto max-w-[190mm] bg-white p-8 text-sm text-black shadow print:max-w-none print:p-0 print:shadow-none"
    >
      {copy && <p className="mb-4 border-2 border-black py-1 text-center text-lg font-bold">COPY</p>}
      <header className="flex justify-between gap-8">
        <div>
          <p className="text-xl font-bold">{settings.shopName}</p>
          <p>{branch.name}</p>
          {branch.address && <p>{branch.address}</p>}
          {branch.phone && <p>{branch.phone}</p>}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">Invoice {sale.invoiceNo}</p>
          <p>{receiptTime(sale.createdAt, settings.timezone)}</p>
          <p>Cashier: {sale.cashierName}</p>
          {sale.customer.name && (
            <p>
              Customer: {sale.customer.name} {sale.customer.phone}
            </p>
          )}
        </div>
      </header>

      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1">Item</th>
            <th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Unit price</th>
            <th className="py-1 text-right">Discount</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((l) => (
            <tr key={l.id} className="border-b border-gray-300">
              <td className="py-1">
                {l.name} <span className="font-mono text-xs text-gray-600">{l.sku}</span>
              </td>
              <td className="py-1 text-right tabular-nums">{l.qty}</td>
              <td className="py-1 text-right tabular-nums">{m(l.unitPrice)}</td>
              <td className="py-1 text-right tabular-nums">
                {l.lineDiscount > 0 ? `−${m(l.lineDiscount)}` : ''}
              </td>
              <td className="py-1 text-right tabular-nums">{m(l.qty * l.unitPrice - l.lineDiscount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mt-4 ml-auto w-72 space-y-1 tabular-nums">
        <Line label="Subtotal" value={m(sale.totals.subtotal)} />
        {sale.totals.discount > 0 && <Line label="Discount" value={`−${m(sale.totals.discount)}`} />}
        {sale.totals.tax > 0 && (
          <Line label={`${settings.taxLabel} ${formatBps(sale.taxRateBps)}`} value={m(sale.totals.tax)} />
        )}
        <Line label="Total" value={m(sale.totals.total)} bold />
        {sale.payments.map((p) => (
          <Line
            key={p.method}
            label={`${METHOD_LABEL[p.method]}${p.reference ? ` (${p.reference})` : ''}`}
            value={m(p.amount)}
          />
        ))}
        {sale.change > 0 && <Line label="Change" value={m(sale.change)} />}
      </dl>
      {settings.invoiceFooter && (
        <p className="mt-8 text-center whitespace-pre-line text-gray-700">{settings.invoiceFooter}</p>
      )}
    </article>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'border-t border-black pt-1 text-base font-bold' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
