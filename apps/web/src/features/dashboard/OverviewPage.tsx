import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { OverviewDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { Badge } from '@/components/ui/badge';
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
import { useActor } from '@/features/auth/useActor';
import { useFormat } from '@/lib/useFormat';
import { POLLING } from './polling';

/** /overview (report:view, FR-DSH-03): today at every branch I may see, plus shop totals. */
export function OverviewPage() {
  const navigate = useNavigate();
  const { settings } = useActor();
  const { money } = useFormat();
  const q = useQuery({
    queryKey: qk.overview,
    queryFn: () => http.get<OverviewDto>('/dashboard/overview'),
    ...POLLING,
  });
  if (q.isError && !q.data) return <p className="text-red-600">Couldn&apos;t load the overview.</p>;
  if (!q.data) return <Skeleton className="h-64 w-full" />;
  const o = q.data;
  const updated = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(q.dataUpdatedAt));
  const many = o.branches.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Overview · today ({o.today})</h1>
        <p className="text-xs text-gray-500" aria-live="polite">
          {q.isFetching ? 'Updating…' : `Updated ${updated}`} · refreshes every minute
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Branch</TableHead>
            <TableHead className="text-right">Sales</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Low</TableHead>
            <TableHead className="text-right">Out</TableHead>
            <TableHead className="text-right">Incoming transfers</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {o.branches.map((b) => (
            <TableRow
              key={b.branchId}
              className="cursor-pointer"
              onClick={() => navigate(`/b/${b.code}/dashboard`)}
            >
              <TableCell>
                <span className="font-mono">{b.code}</span> · {b.name}{' '}
                {!b.isActive && <Badge variant="outline">Inactive</Badge>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{b.sales.count}</TableCell>
              <TableCell className="text-right tabular-nums">{money(b.sales.total)}</TableCell>
              <TableCell className="text-right tabular-nums">{b.lowCount}</TableCell>
              <TableCell className="text-right tabular-nums">{b.outCount}</TableCell>
              <TableCell className="text-right tabular-nums">{b.incomingTransfers}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        {many && (
          <TableFooter>
            <TableRow className="font-semibold">
              <TableCell>All branches</TableCell>
              <TableCell className="text-right tabular-nums">{o.totals.sales.count}</TableCell>
              <TableCell className="text-right tabular-nums">{money(o.totals.sales.total)}</TableCell>
              <TableCell className="text-right tabular-nums">{o.totals.lowCount}</TableCell>
              <TableCell className="text-right tabular-nums">{o.totals.outCount}</TableCell>
              <TableCell className="text-right tabular-nums">{o.totals.incomingTransfers}</TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}
