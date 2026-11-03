import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Page, PODto, PoStatus, SupplierDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { useBranch } from '@/features/branch/useBranch';

export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  draft: 'Draft',
  ordered: 'Ordered',
  partially_received: 'Partially received',
  received: 'Received',
  cancelled: 'Cancelled',
  closed: 'Closed',
};

/** The page AND the API path (the client prefixes /api): /b/GUL/purchase-orders[/id]. */
export const poPath = (code: string, id = '') => `/b/${code}/purchase-orders${id ? `/${id}` : ''}`;

export function usePO(id: string) {
  const branch = useBranch();
  return useQuery({
    queryKey: qk.po(branch.code, id),
    queryFn: () => http.get<{ purchaseOrder: PODto }>(poPath(branch.code, id)).then((r) => r.purchaseOrder),
    enabled: !!id,
  });
}

/**
 * Every PO mutation returns the fresh PO: put it in the cache (the server's numbers win, never patch
 * them locally), then refresh the lists and everything stock-related.
 */
export function usePOMutation<V, R extends { purchaseOrder: PODto }>(id: string, fn: (v: V) => Promise<R>) {
  const branch = useBranch();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    retry: false, // a retry is the user's decision (with the same idempotency key where there is one)
    onSuccess: ({ purchaseOrder }) => {
      qc.setQueryData(qk.po(branch.code, id), purchaseOrder);
      void qc.invalidateQueries({ queryKey: ['pos', branch.code] });
      void qc.invalidateQueries({ queryKey: ['inventory', branch.code] });
      void qc.invalidateQueries({ queryKey: ['inventory-row', branch.code] });
      void qc.invalidateQueries({ queryKey: ['movements', branch.code] });
      void qc.invalidateQueries({ queryKey: ['po-suggestions', branch.code] });
      void qc.invalidateQueries({ queryKey: ['pos-search', branch.code] });
      void qc.invalidateQueries({ queryKey: ['supplier'] }); // "recent POs" on supplier pages
      void qc.invalidateQueries({ queryKey: ['dashboard', branch.code] }); // this tab's own action shows at once
      void qc.invalidateQueries({ queryKey: ['low-stock', branch.code] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

/** Every supplier (following the cursor): pick-lists need them all, and a shop has dozens, not thousands. */
export function useAllSuppliers(active: 'true' | 'all') {
  return useQuery({
    queryKey: qk.suppliers({ all: true, active }),
    queryFn: async () => {
      const out: SupplierDto[] = [];
      let cursor: string | undefined;
      do {
        const sp = new URLSearchParams({ active });
        if (cursor) sp.set('cursor', cursor);
        const page = await http.get<Page<SupplierDto>>(`/suppliers?${sp}`);
        out.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return out;
    },
    staleTime: 60_000,
  });
}
