import type { Permission, TransferDto } from '@shopstock/shared';

export type TransferAction = 'dispatch' | 'cancel' | 'receive';

/**
 * Which buttons a transfer shows to the branch viewing it (data-model.md §9.2): the source dispatches
 * or cancels a pending transfer, the destination receives one in transit, nobody acts on history.
 * The server enforces the same split with its filters (fromBranchId / toBranchId + status CAS).
 */
export function transferActions(
  t: Pick<TransferDto, 'status' | 'fromCode' | 'toCode'>,
  viewerCode: string,
  can: (p: Permission) => boolean,
): TransferAction[] {
  if (!can('transfer:manage')) return [];
  if (t.status === 'pending' && viewerCode === t.fromCode) return ['dispatch', 'cancel'];
  if (t.status === 'in_transit' && viewerCode === t.toCode) return ['receive'];
  return [];
}

/** What the OTHER side is waiting for, shown where this side has no buttons. */
export function transferWaiting(t: Pick<TransferDto, 'status' | 'fromCode' | 'toCode'>, viewerCode: string) {
  if (t.status === 'pending' && viewerCode === t.toCode) return `Waiting for ${t.fromCode} to dispatch.`;
  if (t.status === 'in_transit' && viewerCode === t.fromCode) return `On its way to ${t.toCode}.`;
  return null;
}
