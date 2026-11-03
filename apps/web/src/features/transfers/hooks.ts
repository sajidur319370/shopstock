import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TransferDto, TransferStatus } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { useBranch } from '@/features/branch/useBranch';

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  pending: 'Pending',
  in_transit: 'In transit',
  received: 'Received',
  cancelled: 'Cancelled',
};

/** The page AND the API path (the client prefixes /api). */
export const transferPath = (code: string, id = '') => `/b/${code}/transfers${id ? `/${id}` : ''}`;

export function useTransfer(id: string) {
  const branch = useBranch();
  return useQuery({
    queryKey: qk.transfer(branch.code, id),
    queryFn: () => http.get<{ transfer: TransferDto }>(transferPath(branch.code, id)).then((r) => r.transfer),
    enabled: !!id,
  });
}

/** Dispatch / receive / cancel: cache the fresh transfer, then refresh every stock screen of this branch. */
export function useTransferAction() {
  const branch = useBranch();
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({ id, action }: { id: string; action: 'dispatch' | 'receive' | 'cancel' }) =>
      http
        .post<{ transfer: TransferDto }>(`${transferPath(branch.code, id)}/${action}`)
        .then((r) => r.transfer),
    onSuccess: (t) => {
      qc.setQueryData(qk.transfer(branch.code, t.id), t);
      for (const key of [
        'transfers',
        'inventory',
        'inventory-row',
        'movements',
        'pos-search',
        'po-suggestions',
      ]) {
        void qc.invalidateQueries({ queryKey: [key, branch.code] });
      }
      void qc.invalidateQueries({ queryKey: ['product'] }); // "In transit" on product pages
    },
  });
}
