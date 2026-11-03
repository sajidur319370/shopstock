import { useQuery } from '@tanstack/react-query';
import type { BranchStockDto, CategoryDto, InTransitDto, ProductDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';

export function useCategories() {
  return useQuery({
    queryKey: qk.categories,
    queryFn: () => http.get<{ categories: CategoryDto[] }>('/categories').then((r) => r.categories),
    staleTime: 60_000,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: qk.product(id ?? ''),
    queryFn: () =>
      http.get<{ product: ProductDto; stock: BranchStockDto[]; inTransit: InTransitDto[] }>(
        `/products/${id}`,
      ),
    enabled: !!id,
  });
}
