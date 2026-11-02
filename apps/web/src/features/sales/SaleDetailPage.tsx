import { Link, useParams } from 'react-router';
import { formatBps } from '@shopstock/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { useFormat } from '@/lib/useFormat';
import { METHOD_LABEL, useSale } from './hooks';

/** /b/:code/sales/:saleId (FR-SAL-11): the stored sale. Cost and profit only if the API sent cost. */
export function SaleDetailPage() {
  const branch = useBranch();
  const { saleId = '' } = useParams();
  const { settings, can } = useActor();
  const { money, dateTime } = useFormat();
  const sale = useSale(branch.code, saleId);
  const back = `/b/${branch.code}/sales`;

  if (sale.isError) {
    return (
      <div className="space-y-3">
        <p>Sale not found.</p>
        <Button variant="outline" asChild>
          <Link to={back}>Back to sales</Link>
        </Button>
      </div>
    );
  }
  if (!sale.data) return <Skeleton className="h-96 w-full" />;
  const s = sale.data;
  const showCost = s.totals.cost !== undefined; // the DTO decides (never for cashiers), not the UI
  const anyReturned = s.items.some((l) => l.returnedQty > 0);
  const t = s.totals;

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-semibold">{s.invoiceNo}</h1>
          <p className="text-sm text-gray-600">
            {dateTime(s.createdAt)} · {s.cashierName}
            {s.customer.name && ` · Customer: ${s.customer.name} ${s.customer.phone}`}
          </p>
          {s.note && <p className="text-sm text-gray-600">Note: {s.note}</p>}
          <div className="mt-1 flex gap-2">
            {s.returnStatus !== 'none' && (
              <Badge variant={s.returnStatus === 'full' ? 'destructive' : 'secondary'}>
                {s.returnStatus === 'full' ? 'Returned' : 'Partly returned'}
              </Badge>
            )}
            {s.printCount > 0 && <Badge variant="outline">Printed {s.printCount}×</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          {can('invoice:print') && (
            <Button asChild>
              <Link to={`/b/${branch.code}/sales/${s.id}/print`}>
                {s.printCount > 0 ? 'Reprint' : 'Print'}
              </Link>
            </Button>
          )}
          {can('return:create') && (
            <Button variant="outline" disabled title="Returns arrive on Day 14">
              Return items
            </Button>
          )}
          <Button variant="ghost" asChild>
            <Link to={back}>Back</Link>
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            {anyReturned && <TableHead className="text-right">Returned</TableHead>}
            <TableHead className="text-right">Unit price</TableHead>
            <TableHead className="text-right">Discount</TableHead>
            <TableHead className="text-right">Total</TableHead>
            {showCost && <TableHead className="text-right">Unit cost</TableHead>}
            {showCost && <TableHead className="text-right">Profit</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {s.items.map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                {l.name} <span className="font-mono text-xs text-gray-500">{l.sku}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
              {anyReturned && (
                <TableCell className="text-right text-red-700 tabular-nums">{l.returnedQty || ''}</TableCell>
              )}
              <TableCell className="text-right tabular-nums">{money(l.unitPrice)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {l.lineDiscount + l.cartShare > 0 ? `−${money(l.lineDiscount + l.cartShare)}` : ''}
              </TableCell>
              <TableCell className="text-right tabular-nums">{money(l.total)}</TableCell>
              {showCost && (
                <TableCell className="text-right tabular-nums">{money(l.unitCost ?? 0)}</TableCell>
              )}
              {showCost && (
                // profit on the NET (before tax: the tax belongs to the government)
                <TableCell className="text-right tabular-nums">
                  {money(l.net - (l.unitCost ?? 0) * l.qty)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="text-sm">
          <h2 className="mb-2 font-medium">Payments</h2>
          <dl className="space-y-1 tabular-nums">
            {s.payments.map((p) => (
              <Row
                key={p.method}
                label={`${METHOD_LABEL[p.method]}${p.reference ? ` (${p.reference})` : ''}`}
                value={money(p.amount)}
              />
            ))}
            {s.change > 0 && <Row label="Change given" value={money(s.change)} />}
          </dl>
        </section>
        <dl className="space-y-1 text-sm tabular-nums">
          <Row label="Subtotal" value={money(t.subtotal)} />
          {t.discount > 0 && <Row label="Discount" value={`−${money(t.discount)}`} />}
          <Row label="Net" value={money(t.net)} />
          {t.tax > 0 && (
            <Row label={`${settings.taxLabel} ${formatBps(s.taxRateBps)}`} value={money(t.tax)} />
          )}
          <Row label="Total" value={money(t.total)} bold />
          {t.cost !== undefined && (
            <>
              <Row label="Cost" value={money(t.cost)} />
              <Row label="Gross profit" value={money(t.net - t.cost)} />
            </>
          )}
        </dl>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'border-t pt-1 text-base font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
