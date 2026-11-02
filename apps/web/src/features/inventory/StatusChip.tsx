import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, TriangleAlertIcon } from 'lucide-react';
import type { StockStatus } from '@shopstock/shared';
import { cn } from '@/lib/utils';

const STYLE: Record<StockStatus, { label: string; Icon: typeof CircleCheckIcon; className: string }> = {
  ok: { label: 'OK', Icon: CircleCheckIcon, className: 'text-green-700' },
  low: { label: 'Low', Icon: TriangleAlertIcon, className: 'text-amber-700' },
  out: { label: 'Out', Icon: CircleXIcon, className: 'text-red-700' },
  not_stocked: { label: 'Not stocked', Icon: CircleDashedIcon, className: 'text-gray-500' },
};

/** Icon AND text, never colour alone (NFR-A11Y-02). */
export function StatusChip({ status }: { status: StockStatus }) {
  const { label, Icon, className } = STYLE[status];
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm', className)}>
      <Icon className="size-4" aria-hidden />
      {label}
    </span>
  );
}
