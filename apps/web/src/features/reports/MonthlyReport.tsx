import { useSearchParams } from 'react-router';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MonthlyDto, MonthRowDto } from '@shopstock/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { ChartFigure, useBranchColor, useReport, useReportFormat, type ReportScope } from './shared';

const MONTHS = [3, 6, 12, 24] as const;

/**
 * FR-RPT-04: net sales (solid) and the 3-month moving average (dashed), for the shop or per branch.
 * The period picker doesn't apply: this report always ends with the current month.
 */
export function MonthlyReport({ scope }: { scope: ReportScope }) {
  const [params, setParams] = useSearchParams();
  const months = Number(params.get('months') ?? 12);
  const view = params.get('view') === 'branches' ? 'branches' : 'shop';
  const q = useReport<MonthlyDto>('monthly', { months, branchIds: scope.branchIds.join(',') });
  const { money, tick, pct } = useReportFormat();
  const color = useBranchColor();
  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        p.set(k, v);
        return p;
      },
      { replace: true },
    );
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const r = q.data;

  // One row per month: shop series, or <CODE> / <CODE>~avg per branch.
  const data = r.shop.map((m, i) => ({
    month: m.month,
    net: m.netSales,
    avg: m.movingAvg3,
    ...Object.fromEntries(
      r.perBranch.flatMap((b) => [
        [b.code, b.months[i]?.netSales ?? 0],
        [`${b.code}~avg`, b.months[i]?.movingAvg3 ?? 0],
      ]),
    ),
  }));
  const last = r.shop.at(-1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Months" className="flex overflow-hidden rounded-md border">
          {MONTHS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={months === n}
              onClick={() => set('months', String(n))}
              className={cn('px-3 py-1.5 text-sm', months === n && 'bg-gray-900 text-white')}
            >
              {n} months
            </button>
          ))}
        </div>
        <div role="group" aria-label="Series" className="flex overflow-hidden rounded-md border">
          {(['shop', 'branches'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => set('view', v)}
              className={cn('px-3 py-1.5 text-sm', view === v && 'bg-gray-900 text-white')}
            >
              {v === 'shop' ? 'Shop total' : 'Per branch'}
            </button>
          ))}
        </div>
      </div>

      <ChartFigure
        title="Net sales per month"
        summary={`Net sales for the last ${months} months; this month ${money(last?.netSales ?? 0)}, ${pct(last?.growthBps ?? null)} vs last month, 3-month average ${money(last?.movingAvg3 ?? 0)}.`}
      >
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" fontSize={12} />
            <YAxis tickFormatter={tick} fontSize={12} width={48} />
            <Tooltip formatter={(v) => money(Number(v))} />
            {/* series order, not Recharts 3's A→Z default */}
            <Legend itemSorter={null} />
            {view === 'shop' ? (
              <>
                <Line dataKey="net" name="Net sales" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line
                  dataKey="avg"
                  name="3-month average"
                  stroke="#2563eb"
                  strokeDasharray="6 4"
                  dot={false}
                />
              </>
            ) : (
              r.perBranch.flatMap((b) => [
                <Line key={b.code} dataKey={b.code} stroke={color(b.code)} strokeWidth={2} dot={false} />,
                <Line
                  key={`${b.code}~avg`}
                  dataKey={`${b.code}~avg`}
                  name={`${b.code} 3-month avg`}
                  stroke={color(b.code)}
                  strokeDasharray="6 4"
                  dot={false}
                />,
              ])
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartFigure>

      {view === 'shop' ? (
        <MonthTable rows={r.shop} money={money} pct={pct} />
      ) : (
        r.perBranch.map((b) => (
          <section key={b.code} className="space-y-1">
            <h3 className="text-sm font-medium">
              <span className="font-mono">{b.code}</span> · {b.name}
            </h3>
            <MonthTable rows={b.months} money={money} pct={pct} />
          </section>
        ))
      )}
    </div>
  );
}

function MonthTable({
  rows,
  money,
  pct,
}: {
  rows: MonthRowDto[];
  money: (v: number) => string;
  pct: (bps: number | null) => string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Net sales</TableHead>
          <TableHead className="text-right">Growth</TableHead>
          <TableHead className="text-right">3-month avg</TableHead>
          <TableHead className="text-right">Gross profit</TableHead>
          <TableHead className="text-right">Sales</TableHead>
          <TableHead className="text-right">Avg basket</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((m) => (
          <TableRow key={m.month}>
            <TableCell className="tabular-nums">{m.month}</TableCell>
            <TableCell className="text-right tabular-nums">{money(m.netSales)}</TableCell>
            <TableCell className="text-right tabular-nums">{pct(m.growthBps)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(m.movingAvg3)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(m.grossProfit)}</TableCell>
            <TableCell className="text-right tabular-nums">{m.sales}</TableCell>
            <TableCell className="text-right tabular-nums">{money(m.avgBasket)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
