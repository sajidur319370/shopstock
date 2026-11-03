import type { PODto, Permission } from '@shopstock/shared';

export type POAction = 'edit' | 'delete' | 'order' | 'receive' | 'cancel' | 'close';

/**
 * Which buttons a PO shows: a pure function of its status and the user's permissions, written once
 * (data-model.md §9.1) instead of `status === 'draft'` checks scattered through JSX. The server
 * re-checks every transition with a compare-and-set anyway.
 */
export function poActions(po: Pick<PODto, 'status' | 'items'>, can: (p: Permission) => boolean): POAction[] {
  const manage = can('po:manage');
  const receive = can('po:receive');
  const nothingReceived = po.items.every((i) => i.receivedQty === 0);

  switch (po.status) {
    case 'draft':
      return manage ? ['edit', 'order', 'delete', 'cancel'] : [];
    case 'ordered':
      return [
        ...(receive ? (['receive'] as const) : []),
        ...(manage && nothingReceived ? (['cancel'] as const) : []),
      ];
    case 'partially_received':
      return [...(receive ? (['receive'] as const) : []), ...(manage ? (['close'] as const) : [])];
    default: // received, cancelled, closed: history only
      return [];
  }
}
