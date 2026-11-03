import { useSearchParams } from 'react-router';
import { toBusinessDate } from '@shopstock/shared';
import { Input } from '@/components/ui/input';
import { useActor } from '@/features/auth/useActor';
import { cn } from '@/lib/utils';
import { BestSellersReport } from './BestSellersReport';
import { DailyReport } from './DailyReport';
import { MonthlyReport } from './MonthlyReport';
import { PRESET_LABEL, PRESETS, presetOf, presetRange, validRange, type Preset } from './periods';
import { ProfitReport } from './ProfitReport';
import type { ReportScope } from './shared';

const TABS = [
  ['daily', 'Daily sales'],
  ['best', 'Best sellers'],
  ['profit', 'Profit per branch'],
  ['monthly', 'Monthly trends'],
] as const;
type Tab = (typeof TABS)[number][0];

/**
 * /reports (report:view), lazy-loaded with Recharts in its own chunk. Everything lives in the URL
 * (`?tab=daily&from=…&to=…&branches=GUL,DHN`): a shared link opens the same report. Branch CODES in
 * the URL (readable), mapped to ids for the API; none ticked = all my branches (the API's default).
 */
export default function ReportsPage() {
  const { settings, branches } = useActor();
  const [params, setParams] = useSearchParams();
  const today = toBusinessDate(new Date(), settings.timezone); // the SHOP's today
  const fallback = presetRange('last30', today);
  const tab = (TABS.find(([t]) => t === params.get('tab'))?.[0] ?? 'daily') as Tab;
  const from = params.get('from') ?? fallback.from;
  const to = params.get('to') ?? fallback.to;
  const mine = [...branches].sort((a, b) => a.code.localeCompare(b.code));
  const picked = (params.get('branches') ?? '').split(',').filter((c) => mine.some((b) => b.code === c));
  const scope: ReportScope = {
    from,
    to,
    branchIds: mine.filter((b) => picked.includes(b.code)).map((b) => b.id),
  };
  const preset = presetOf(from, to, today);
  const ok = validRange(from, to);

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(patch)) {
          if (v) p.set(k, v);
          else p.delete(k);
        }
        return p;
      },
      { replace: true },
    );
  const toggleBranch = (code: string, on: boolean) => {
    const next = on ? [...picked, code] : picked.filter((c) => c !== code);
    update({ branches: next.length && next.length < mine.length ? next.join(',') : null });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Reports</h1>
        {tab !== 'monthly' && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Period"
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
              value={preset}
              onChange={(e) => {
                if (e.target.value === 'custom') return;
                update(presetRange(e.target.value as Preset, today));
              }}
            >
              {[...PRESETS, 'custom' as const].map((p) => (
                <option key={p} value={p} disabled={p === 'custom'}>
                  {PRESET_LABEL[p]}
                </option>
              ))}
            </select>
            <Input
              type="date"
              aria-label="From"
              className="h-9 w-40"
              value={from}
              max={today}
              onChange={(e) => update({ from: e.target.value })}
            />
            <span className="text-sm text-gray-500">to</span>
            <Input
              type="date"
              aria-label="To"
              className="h-9 w-40"
              value={to}
              max={today}
              onChange={(e) => update({ to: e.target.value })}
            />
          </div>
        )}
      </div>

      {mine.length > 1 && (
        <fieldset className="flex flex-wrap items-center gap-3 text-sm">
          <legend className="sr-only">Branches</legend>
          <span className="text-gray-600">Branches</span>
          {mine.map((b) => (
            <label key={b.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={picked.length === 0 || picked.includes(b.code)}
                onChange={(e) =>
                  picked.length === 0
                    ? // "all" → untick one: tick every OTHER branch explicitly
                      update({
                        branches:
                          mine
                            .filter((x) => x.code !== b.code)
                            .map((x) => x.code)
                            .join(',') || null,
                      })
                    : toggleBranch(b.code, e.target.checked)
                }
              />
              <span className="font-mono">{b.code}</span>
            </label>
          ))}
        </fieldset>
      )}

      <div role="tablist" aria-label="Report" className="flex flex-wrap gap-1 border-b">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => update({ tab: t === 'daily' ? null : t })}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === t
                ? 'border-gray-900 font-medium'
                : 'border-transparent text-gray-600 hover:text-gray-900',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab !== 'monthly' && !ok ? (
          <p className="text-sm text-red-700">
            Choose a period of 1 to 366 days, with the start before the end.
          </p>
        ) : tab === 'daily' ? (
          <DailyReport scope={scope} />
        ) : tab === 'best' ? (
          <BestSellersReport scope={scope} />
        ) : tab === 'profit' ? (
          <ProfitReport scope={scope} />
        ) : (
          <MonthlyReport scope={scope} />
        )}
      </div>
    </div>
  );
}
