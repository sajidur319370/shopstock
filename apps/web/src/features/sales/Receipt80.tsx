import { formatBps, formatMoney } from '@shopstock/shared';
import { METHOD_LABEL } from './hooks';
import { receiptTime, type ReceiptProps } from './receipt';

/** 80 mm thermal roll: one narrow monospace column. Totals are the STORED totals, never re-added here. */
export function Receipt80({ sale, branch, settings, copy }: ReceiptProps) {
  const m = (v: number) => formatMoney(v, settings.currency);
  return (
    <article
      data-testid="receipt"
      className="mx-auto w-[80mm] bg-white p-3 font-mono text-[12px] leading-tight text-black shadow print:p-2 print:shadow-none"
    >
      {copy && <p className="mb-1 border border-black text-center font-bold">COPY</p>}
      <header className="text-center">
        <p className="text-base font-bold">{settings.shopName}</p>
        <p>
          {branch.name}
          {branch.address && ` · ${branch.address}`}
        </p>
        {branch.phone && <p>{branch.phone}</p>}
      </header>
      <hr className="my-2 border-dashed border-black" />
      <p>Invoice: {sale.invoiceNo}</p>
      <p>
        {receiptTime(sale.createdAt, settings.timezone)} · {sale.cashierName}
      </p>
      {sale.customer.name && (
        <p>
          Customer: {sale.customer.name} {sale.customer.phone}
        </p>
      )}
      <hr className="my-2 border-dashed border-black" />
      {sale.items.map((l) => (
        <div key={l.id} className="mb-1">
          <p>{l.name}</p>
          <Row label={`${l.qty} × ${m(l.unitPrice)}`} value={m(l.qty * l.unitPrice)} />
          {l.lineDiscount > 0 && <Row label="  discount" value={`−${m(l.lineDiscount)}`} />}
        </div>
      ))}
      <hr className="my-2 border-dashed border-black" />
      <Row label="Subtotal" value={m(sale.totals.subtotal)} />
      {sale.totals.discount > 0 && <Row label="Discount" value={`−${m(sale.totals.discount)}`} />}
      {sale.totals.tax > 0 && (
        // the sale's OWN rate: the setting may have changed since
        <Row label={`${settings.taxLabel} ${formatBps(sale.taxRateBps)}`} value={m(sale.totals.tax)} />
      )}
      <Row label="TOTAL" value={m(sale.totals.total)} bold />
      {sale.payments.map((p) => (
        <Row key={p.method} label={METHOD_LABEL[p.method]} value={m(p.amount)} />
      ))}
      {sale.change > 0 && <Row label="Change" value={m(sale.change)} />}
      <hr className="my-2 border-dashed border-black" />
      {settings.invoiceFooter && <p className="text-center whitespace-pre-line">{settings.invoiceFooter}</p>}
    </article>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <p className={`flex justify-between gap-2 whitespace-pre ${bold ? 'text-sm font-bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </p>
  );
}
