import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PAYMENT_METHODS, type BranchDashboardDto, type ShiftDashboardDto } from '@shopstock/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Can, useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { POStatusBadge } from '@/features/purchasing/POStatusBadge';
import { METHOD_LABEL } from '@/features/sales/hooks';
import { useFormat } from '@/lib/useFormat';
import { LowStockStatus } from './LowStockStatus';
import { useDashboard } from './useDashboard';

/** "2026-10-26" → "Mon 26 Oct" (a calendar date: formatted in UTC so no timezone shifts it). */
const dayLabel = (d: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

/** /b/:code/dashboard (dashboard:view). One page, two layouts by `data.kind`. */
export function DashboardPage() {
  const branch = useBranch();
  const { settings } = useActor();
  const q = useDashboard();
  if (q.isError && !q.data) return <p className="text-red-600">Couldn&apos;t load the dashboard.</p>;
  if (!q.data) return <Skeleton className="h-96 w-full" />;

  const updated = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(q.dataUpdatedAt));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Dashboard · {branch.code} · {dayLabel(q.data.today)}
        </h1>
        <p className="text-xs text-gray-500" aria-live="polite">
          {q.isFetching ? 'Updating…' : `Updated ${updated}`} · refreshes every minute
        </p>
      </div>
      {q.data.kind === 'branch' ? <ManagerView d={q.data} /> : <CashierView d={q.data} />}
    </div>
  );
}

function ManagerView({ d }: { d: BranchDashboardDto }) {
  const branch = useBranch();
  const { settings } = useActor();
  const { money } = useFormat();
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: settings.timezone,
    hour: '2-digit',
    minute: '2-digit',
  });
  const b = `/b/${branch.code}`;
  const maxMethod = Math.max(1, ...PAYMENT_METHODS.map((m) => d.byMethod[m]));
  const reorderIds = d.lowStock.top.map((r) => r.productId).join(',');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sales today" value={String(d.sales.count)} />
        <Stat label="Net sales" value={money(d.sales.net)} hint={`${money(d.sales.total)} incl. tax`} />
        <Stat label="Avg basket" value={money(d.sales.avgBasket)} />
        <Stat label="Refunds today" value={`${d.refunds.count} · ${money(d.refunds.amount)}`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="By payment method">
          <ul className="space-y-2 text-sm">
            {PAYMENT_METHODS.map((m) => (
              <li key={m} className="grid grid-cols-[5rem_8rem_1fr] items-center gap-2">
                <span>{METHOD_LABEL[m]}</span>
                <span className="text-right tabular-nums">{money(d.byMethod[m])}</span>
                <span className="h-2 rounded bg-gray-100">
                  <span
                    className="block h-2 rounded bg-gray-800"
                    style={{ width: `${(d.byMethod[m] / maxMethod) * 100}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">Cash is what was collected: tendered minus change.</p>
        </Panel>
        <Panel title="Sales by hour">
          <HourBars hours={d.byHour} />
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel
          title={`Low stock: ${d.lowStock.lowCount} low · ${d.lowStock.outCount} out`}
          action={
            <Link className="text-sm underline" to={`${b}/low-stock`}>
              View all
            </Link>
          }
        >
          {d.lowStock.top.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing is low at {branch.code}.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {d.lowStock.top.map((r) => (
                <li key={r.productId} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <LowStockStatus status={r.status} />
                    {r.name}
                  </span>
                  <span className="tabular-nums">
                    {r.quantity} / {r.reorderLevel}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {d.lowStock.top.length > 0 && (
            <Can permission="po:manage">
              <Button size="sm" variant="outline" className="mt-3" asChild>
                <Link to={`${b}/purchase-orders/new?from=low-stock&products=${reorderIds}`}>Reorder</Link>
              </Button>
            </Can>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Incoming transfers">
            {d.incomingTransfers.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing on its way here.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {d.incomingTransfers.map((t) => (
                  <li key={t.id}>
                    <Link className="font-mono underline" to={`${b}/transfers/${t.id}`}>
                      {t.transferNo}
                    </Link>{' '}
                    from {t.fromCode} · {t.units} units
                  </li>
                ))}
              </ul>
            )}
            {d.outgoingPending > 0 && (
              <p className="mt-2 text-sm">
                <Link className="underline" to={`${b}/transfers?direction=outgoing&status=pending`}>
                  Outgoing pending: {d.outgoingPending}
                </Link>
              </p>
            )}
          </Panel>
          <Panel title="Open purchase orders">
            {d.openPOs.length === 0 ? (
              <p className="text-sm text-gray-500">No open purchase orders.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {d.openPOs.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <Link className="font-mono underline" to={`${b}/purchase-orders/${p.id}`}>
                      {p.poNumber}
                    </Link>
                    · {p.supplierName} <POStatusBadge status={p.status} />
                    {p.expectedDate && <span className="text-gray-500">due {p.expectedDate}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Recent sales">
        {d.recentSales.length === 0 ? (
          <p className="text-sm text-gray-500">No sales yet today.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d.recentSales.map((s) => (
              <li key={s.id} className="grid grid-cols-[auto_auto_1fr_auto] gap-3">
                <span className="tabular-nums text-gray-500">{time.format(new Date(s.createdAt))}</span>
                <Link className="font-mono underline" to={`${b}/sales/${s.id}`}>
                  {s.invoiceNo}
                </Link>
                <span>{s.cashierName}</span>
                <span className="text-right tabular-nums">{money(s.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** Plain divs (no chart library on this page): from the first to the last hour with sales. */
function HourBars({ hours }: { hours: BranchDashboardDto['byHour'] }) {
  const { money } = useFormat();
  const withSales = hours.filter((h) => h.count > 0);
  if (withSales.length === 0) return <p className="text-sm text-gray-500">No sales yet today.</p>;
  const shown = hours.slice(withSales[0]!.hour, withSales.at(-1)!.hour + 1);
  const max = Math.max(...shown.map((h) => h.total));
  const hh = (h: number) => String(h).padStart(2, '0');
  return (
    <div className="flex h-32 items-end gap-1" role="list" aria-label="Sales by hour">
      {shown.map((h) => (
        <div key={h.hour} role="listitem" className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-gray-800"
            style={{ height: `${max ? (h.total / max) * 100 : 0}%`, minHeight: h.count ? 2 : 0 }}
            aria-label={`${hh(h.hour)}:00–${hh(h.hour + 1)}:00: ${h.count} sale${h.count === 1 ? '' : 's'}, ${money(h.total)}`}
            title={`${h.count} sales · ${money(h.total)}`}
          />
          <span className="text-[10px] text-gray-500 tabular-nums">{hh(h.hour)}</span>
        </div>
      ))}
    </div>
  );
}

function CashierView({ d }: { d: ShiftDashboardDto }) {
  const branch = useBranch();
  const { money } = useFormat();
  const s = d.shift;
  return (
    <div className="max-w-xl space-y-4">
      <Panel title="Your shift today">
        <p className="text-lg tabular-nums">
          {s.count} sale{s.count === 1 ? '' : 's'} · {money(s.total)}
        </p>
        <p className="text-sm text-gray-600 tabular-nums">
          {PAYMENT_METHODS.map((m) => `${METHOD_LABEL[m].toLowerCase()} ${money(s.byMethod[m] ?? 0)}`).join(
            ' · ',
          )}
        </p>
      </Panel>
      <p className="text-sm">
        <Link className="underline" to={`/b/${branch.code}/low-stock`}>
          {d.lowStockCount === 0
            ? `Nothing is low at ${branch.code}.`
            : `${d.lowStockCount} item${d.lowStockCount === 1 ? '' : 's'} low at ${branch.code}`}
        </Link>
      </p>
      <Button size="lg" asChild>
        <Link to={`/b/${branch.code}/pos`}>Open POS</Link>
      </Button>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-gray-500 tabular-nums">{hint}</p>}
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
