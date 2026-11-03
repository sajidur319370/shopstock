import { useQuery } from '@tanstack/react-query';
import type { ReturnDto, ReturnReason } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';

export const REASON_LABEL: Record<ReturnReason, string> = {
  changed_mind: 'Changed mind',
  damaged: 'Damaged',
  wrong_item: 'Wrong item',
  expired: 'Expired',
  other: 'Other',
};

/** Reasons that usually mean the goods can't be sold again: the restock box starts unticked. */
export const WRITE_OFF_REASONS: ReadonlySet<ReturnReason> = new Set(['damaged', 'expired']);

export function useSaleReturn(code: string, id: string, initial?: ReturnDto) {
  return useQuery({
    queryKey: qk.saleReturn(code, id),
    queryFn: () => http.get<{ return: ReturnDto }>(`/b/${code}/returns/${id}`).then((r) => r.return),
    initialData: initial, // straight from the return screen: no second round trip
  });
}
