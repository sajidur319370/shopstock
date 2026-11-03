import type { PoStatus } from '@shopstock/shared';
import { cn } from '@/lib/utils';
import { PO_STATUS_LABEL } from './hooks';

const STYLE: Record<PoStatus, { icon: string; className: string }> = {
  draft: { icon: '○', className: 'border-gray-300 text-gray-700' },
  ordered: { icon: '●', className: 'border-blue-300 bg-blue-50 text-blue-800' },
  partially_received: { icon: '◐', className: 'border-amber-300 bg-amber-50 text-amber-800' },
  received: { icon: '✓', className: 'border-green-300 bg-green-50 text-green-800' },
  cancelled: { icon: '⊘', className: 'border-gray-300 bg-gray-50 text-gray-500' },
  closed: { icon: '■', className: 'border-gray-300 bg-gray-100 text-gray-700' },
};

/** Icon + text, never colour alone (NFR-A11Y-02). */
export function POStatusBadge({ status }: { status: PoStatus }) {
  const s = STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap',
        s.className,
      )}
    >
      <span aria-hidden>{s.icon}</span>
      {PO_STATUS_LABEL[status]}
    </span>
  );
}
