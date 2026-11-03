import type { TransferStatus } from '@shopstock/shared';
import { cn } from '@/lib/utils';
import { TRANSFER_STATUS_LABEL } from './hooks';

const STYLE: Record<TransferStatus, { icon: string; className: string }> = {
  pending: { icon: '○', className: 'border-gray-300 text-gray-700' },
  in_transit: { icon: '●', className: 'border-blue-300 bg-blue-50 text-blue-800' },
  received: { icon: '✓', className: 'border-green-300 bg-green-50 text-green-800' },
  cancelled: { icon: '⊘', className: 'border-gray-300 bg-gray-50 text-gray-500' },
};

/** Icon + text, never colour alone (NFR-A11Y-02). */
export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  const s = STYLE[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap',
        s.className,
      )}
    >
      <span aria-hidden>{s.icon}</span>
      {TRANSFER_STATUS_LABEL[status]}
    </span>
  );
}
