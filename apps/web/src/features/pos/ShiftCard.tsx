import { useBranch } from '@/features/branch/useBranch';
import { useShiftSummary } from '@/features/sales/hooks';
import { useFormat } from '@/lib/useFormat';

/** "Today: 23 sales · ৳18,450.00 · cash ৳12,300.00" (FR-SAL-12). Cash = collected, i.e. after change. */
export function ShiftCard() {
  const branch = useBranch();
  const { money } = useFormat();
  const { data } = useShiftSummary(branch.code);
  if (!data) return null;
  return (
    <span data-testid="shift" className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-700 tabular-nums">
      Today: {data.count} {data.count === 1 ? 'sale' : 'sales'} · {money(data.total)} · cash{' '}
      {money(data.byMethod.cash ?? 0)}
    </span>
  );
}
