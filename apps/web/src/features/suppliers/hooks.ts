import { useQuery } from '@tanstack/react-query';
import type { SupplierDetailDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';

/** { supplier, recentPOs } — the POs are only those of MY branches (the API filters). */
export function useSupplier(id: string | undefined) {
  return useQuery({
    queryKey: qk.supplier(id ?? ''),
    queryFn: () => http.get<SupplierDetailDto>(`/suppliers/${id}`),
    enabled: !!id,
  });
}
