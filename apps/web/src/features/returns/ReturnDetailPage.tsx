import { Link, useLocation, useParams } from 'react-router';
import { formatMoney, type ReturnDto } from '@shopstock/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { METHOD_LABEL, useBranchDetails } from '@/features/sales/hooks';
import { receiptTime } from '@/features/sales/receipt';
import { useFormat } from '@/lib/useFormat';
import { REASON_LABEL, useSaleReturn } from './hooks';

/** /b/:code/returns/:returnId: what came back, what was refunded, and (Manager+) what it cost. */
export function ReturnDetailPage() {
  const branch = useBranch();
  const { returnId = '' } = useParams();
  const { money, dateTime } = useFormat();
  const stateRet = (useLocation().state as { ret?: ReturnDto } | null)?.ret;
  const ret = useSaleReturn(branch.code, returnId, stateRet?.id === returnId ? stateRet : undefined);
  const back = `/b/${branch.code}/returns`;

  if (ret.isError) {
    return (
      <div className="space-y-3">
        <p>Return not found.</p>
        <Button variant="outline" asChild>
          <Link to={back}>Back to returns</Link>
        </Button>
      </div>
    );
  }
  if (!ret.data) return <Skeleton className="h-96 w-full" />;
  const r = ret.data;
  const showCost = r.totals.writeOff !== undefined; // the DTO decides, not the UI

  return (
    <>
      <style>{'@page { size: 80mm auto; margin: 0 }'}</style>
      <div className="max-w-4xl space-y-4 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-mono text-xl font-semibold">{r.returnNo}</h1>
            <p className="text-sm text-gray-600">
              {dateTime(r.createdAt)} · {r.processedByName} · against{' '}
              <Link className="font-mono underline" to={`/b/${branch.code}/sales/${r.saleId}`}>
                {r.invoiceNo}
              </Link>
            </p>
            <p className="text-sm text-gray-600">
              Reason: {REASON_LABEL[r.reason]}
              {r.note && ` · ${r.note}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => window.print()}>Print</Button>
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
              <TableHead>Stock</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <TableHead className="text-right">Refund</TableHead>
              {showCost && <TableHead className="text-right">Write-off</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.items.map((i) => (
              <TableRow key={i.saleLineId}>
                <TableCell>
                  {i.name} <span className="font-mono text-xs text-gray-500">{i.sku}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{i.qty}</TableCell>
                <TableCell>
                  {i.restock ? (
                    <Badge variant="secondary">Restocked</Badge>
                  ) : (
                    <Badge variant="destructive">Written off</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(i.net)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(i.tax)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(i.total)}</TableCell>
                {showCost && (
                  <TableCell className="text-right tabular-nums">
                    {i.writeOffCost ? money(i.writeOffCost) : ''}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <dl className="ml-auto max-w-xs space-y-1 text-sm tabular-nums">
          <Row label="Net" value={money(r.totals.net)} />
          <Row label="Tax" value={money(r.totals.tax)} />
          <Row label={`Refund (${METHOD_LABEL[r.refund.method]})`} value={money(r.refund.amount)} bold />
          {showCost && (
            <>
              <Row label="Cost back in stock" value={money(r.totals.costRestocked ?? 0)} />
              <Row label="Written off (loss)" value={money(r.totals.writeOff ?? 0)} />
            </>
          )}
        </dl>
      </div>
      <ReturnSlip ret={r} />
    </>
  );
}

/** The customer's copy: printed only (hidden on screen). Same 80 mm layout as the sale receipt. */
function ReturnSlip({ ret: r }: { ret: ReturnDto }) {
  const branch = useBranch();
  const details = useBranchDetails(branch.code);
  const { settings } = useActor();
  const m = (v: number) => formatMoney(v, settings.currency);
  return (
    <article
      data-testid="return-slip"
      className="hidden w-[80mm] bg-white p-2 font-mono text-[12px] leading-tight text-black print:block"
    >
      <header className="text-center">
        <p className="text-base font-bold">{settings.shopName}</p>
        <p>{details.data?.name ?? branch.name}</p>
        {details.data?.phone && <p>{details.data.phone}</p>}
        <p className="mt-1 font-bold">RETURN</p>
      </header>
      <hr className="my-2 border-dashed border-black" />
      <p>Return: {r.returnNo}</p>
      <p>Invoice: {r.invoiceNo}</p>
      <p>
        {receiptTime(r.createdAt, settings.timezone)} · {r.processedByName}
      </p>
      <hr className="my-2 border-dashed border-black" />
      {r.items.map((i) => (
        <div key={i.saleLineId} className="mb-1">
          <p>{i.name}</p>
          <SlipRow label={`${i.qty} returned`} value={m(i.total)} />
        </div>
      ))}
      <hr className="my-2 border-dashed border-black" />
      {r.totals.tax > 0 && <SlipRow label={`incl. ${settings.taxLabel}`} value={m(r.totals.tax)} />}
      <SlipRow label={`REFUND (${METHOD_LABEL[r.refund.method]})`} value={m(r.refund.amount)} bold />
      <p className="mt-1">Reason: {REASON_LABEL[r.reason]}</p>
    </article>
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

function SlipRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <p className={`flex justify-between gap-2 whitespace-pre ${bold ? 'text-sm font-bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </p>
  );
}
