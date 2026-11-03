import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailySalesDto, DailySums } from '@shopstock/shared';
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
import { ChartFigure, Empty, useBranchColor, useReport, useReportFormat, type ReportScope } from './shared';

const COLS: [keyof DailySums, string][] = [
  ['sales', 'Sales'],
  ['gross', 'Gross'],
  ['discount', 'Discounts'],
  ['netSales', 'Net sales'],
  ['tax', 'Tax'],
  ['refunds', 'Refunds'],
  ['collected', 'Collected'],
  ['avgBasket', 'Avg basket'],
];

/** FR-RPT-01: stacked net sales per day and branch; the table (with the period total) underneath. */
export function DailyReport({ scope }: { scope: ReportScope }) {
  const q = useReport<DailySalesDto>('daily-sales', { ...scope, branchIds: scope.branchIds.join(',') });
  const { money, tick } = useReportFormat();
  const color = useBranchColor();
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const r = q.data;
  const data = r.days.map((d) => ({
    day: d.day.slice(5),
    all: d.all,
    ...Object.fromEntries(d.branches.map((b) => [b.code, b.netSales])),
  }));
  const cell = (k: keyof DailySums, v: number) => (k === 'sales' ? String(v) : money(v));

  return (
    <div className="space-y-4">
      {r.totals.sales === 0 && r.totals.refundCount === 0 ? (
        <Empty>No sales or returns in this period.</Empty>
      ) : (
        <ChartFigure
          title="Net sales per day"
          summary={`Net sales per day by branch, ${r.days[0]?.day} to ${r.days.at(-1)?.day}: ${money(r.totals.netSales)} in total over ${r.totals.sales} sales.`}
        >
          <ResponsiveContainer>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" fontSize={12} />
              <YAxis tickFormatter={tick} fontSize={12} width={48} />
              <Tooltip
                content={({ active, payload, label }) => {
                  const all = (payload?.[0]?.payload as { all?: DailySums } | undefined)?.all;
                  if (!active || !all) return null;
                  return (
                    <div className="rounded-md border bg-white p-2 text-xs shadow">
                      <p className="font-medium">{label}</p>
                      {payload?.map((p) => (
                        <p key={String(p.dataKey)}>
                          {String(p.dataKey)}: {money(Number(p.value))}
                        </p>
                      ))}
                      <p className="mt-1 text-gray-600">
                        {all.sales} sales · refunds {money(all.refunds)} · collected {money(all.collected)}
                      </p>
                    </div>
                  );
                }}
              />
              {/* series order, not Recharts 3's A→Z default */}
              <Legend itemSorter={null} />
              {r.branches.map((b) => (
                <Bar key={b.code} dataKey={b.code} stackId="net" fill={color(b.code)} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartFigure>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            {COLS.map(([, l]) => (
              <TableHead key={l} className="text-right">
                {l}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.days.map((d) => (
            <TableRow
              key={d.day}
              className={d.all.sales === 0 && d.all.refundCount === 0 ? 'text-gray-500' : undefined}
            >
              <TableCell className="whitespace-nowrap tabular-nums">{d.day}</TableCell>
              {COLS.map(([k]) => (
                <TableCell key={k} className="text-right tabular-nums">
                  {cell(k, d.all[k])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="font-semibold">
            <TableCell>Period</TableCell>
            {COLS.map(([k]) => (
              <TableCell key={k} className="text-right tabular-nums">
                {cell(k, r.totals[k])}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      </Table>
      <p className="text-xs text-gray-500">
        Net sales and tax are after the period&apos;s returns. Returns count on the day they happen, not on
        the day of the sale.
      </p>
    </div>
  );
}
