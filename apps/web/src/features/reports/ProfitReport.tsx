import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ProfitDto, ProfitRowDto } from '@shopstock/shared';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChartFigure, Empty, useReport, useReportFormat, type ReportScope } from './shared';

const SERIES = [
  ['netSales', 'Net sales', '#2563eb'],
  ['cogs', 'COGS', '#9ca3af'],
  ['grossProfit', 'Gross profit', '#16a34a'],
] as const;

/** FR-RPT-03: grouped bars per branch + the table with a total row (margins recomputed, never averaged). */
export function ProfitReport({ scope }: { scope: ReportScope }) {
  const q = useReport<ProfitDto>('profit', { ...scope, branchIds: scope.branchIds.join(',') });
  const { money, tick, pct } = useReportFormat();
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const r = q.data;
  // Shrinkage in WORDS too, not only colour: "−৳200.00 loss".
  const shrink = (v: number) => (v < 0 ? `${money(v)} loss` : v > 0 ? `+${money(v)} found` : money(0));
  const cells = (x: ProfitRowDto) => (
    <>
      <TableCell className="text-right tabular-nums">{x.sales}</TableCell>
      <TableCell className="text-right tabular-nums">{x.returns}</TableCell>
      <TableCell className="text-right tabular-nums">{money(x.netSales)}</TableCell>
      <TableCell className="text-right tabular-nums">{money(x.cogs)}</TableCell>
      <TableCell className="text-right tabular-nums">{money(x.grossProfit)}</TableCell>
      <TableCell className="text-right tabular-nums">{pct(x.marginBps)}</TableCell>
      <TableCell className={`text-right tabular-nums ${x.shrinkage < 0 ? 'text-red-700' : ''}`}>
        {shrink(x.shrinkage)}
      </TableCell>
      <TableCell className="text-right tabular-nums">{money(x.profitAfterShrinkage)}</TableCell>
    </>
  );

  return (
    <div className="space-y-4">
      {r.total.sales === 0 && r.total.returns === 0 && r.total.shrinkage === 0 ? (
        <Empty>No sales, returns or stock losses in this period.</Empty>
      ) : (
        <ChartFigure
          title="Net sales, cost of goods and gross profit per branch"
          summary={`Gross profit ${money(r.total.grossProfit)} on net sales of ${money(r.total.netSales)} (${pct(r.total.marginBps)} margin) across ${r.rows.length} branches.`}
        >
          <ResponsiveContainer>
            <BarChart data={r.rows}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="code" fontSize={12} />
              <YAxis tickFormatter={tick} fontSize={12} width={48} />
              <Tooltip formatter={(v) => money(Number(v))} />
              {/* series order, not Recharts 3's A→Z default */}
              <Legend itemSorter={null} />
              {SERIES.map(([k, l, c]) => (
                <Bar key={k} dataKey={k} name={l} fill={c} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartFigure>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Branch</TableHead>
            <TableHead className="text-right">Sales</TableHead>
            <TableHead className="text-right">Returns</TableHead>
            <TableHead className="text-right">Net sales</TableHead>
            <TableHead className="text-right">COGS</TableHead>
            <TableHead className="text-right">Gross profit</TableHead>
            <TableHead className="text-right">Margin</TableHead>
            <TableHead className="text-right">Shrinkage</TableHead>
            <TableHead className="text-right">After shrinkage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.rows.map((x) => (
            <TableRow key={x.branchId}>
              <TableCell>
                <span className="font-mono">{x.code}</span> · {x.name}
              </TableCell>
              {cells(x)}
            </TableRow>
          ))}
        </TableBody>
        {r.rows.length > 1 && (
          <TableFooter>
            <TableRow className="font-semibold">
              <TableCell>Total</TableCell>
              {cells(r.total)}
            </TableRow>
          </TableFooter>
        )}
      </Table>
      <p className="text-xs text-gray-500">
        COGS excludes returned goods. Shrinkage is damaged, expired, lost, found and count corrections, plus
        returns that were written off.
      </p>
    </div>
  );
}
