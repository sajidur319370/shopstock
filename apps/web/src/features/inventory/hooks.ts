import { useQueryClient } from '@tanstack/react-query';
import type { InventoryRowDto, Page } from '@shopstock/shared';
import { http } from '@/api/client';

/** Read-your-writes: after any stock change, every screen showing this branch's stock refetches. */
export function useInvalidateStock(code: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['inventory', code] }),
      qc.invalidateQueries({ queryKey: ['inventory-row', code] }),
      qc.invalidateQueries({ queryKey: ['movements', code] }),
      qc.invalidateQueries({ queryKey: ['product'] }), // "stock at my branches" on product detail
    ]);
}

export const inventoryPath = (code: string, f: { categoryId?: string; q?: string; cursor?: string }) => {
  const sp = new URLSearchParams();
  if (f.categoryId) sp.set('categoryId', f.categoryId);
  if (f.q) sp.set('q', f.q);
  if (f.cursor) sp.set('cursor', f.cursor);
  const qs = sp.toString();
  return `/b/${code}/inventory${qs ? `?${qs}` : ''}`;
};

/** Every row of a (category) filter, following the cursor to the end: the stock count needs them all. */
export async function fetchAllInventory(code: string, categoryId?: string) {
  const rows: InventoryRowDto[] = [];
  let cursor: string | undefined;
  do {
    const page: Page<InventoryRowDto> = await http.get(inventoryPath(code, { categoryId, cursor }));
    rows.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return rows;
}
