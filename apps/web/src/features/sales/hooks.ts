import { useQuery } from '@tanstack/react-query';
import type { BranchDto, PaymentMethod, SaleDto, ShiftSummaryDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';

export const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', card: 'Card', mobile: 'Mobile' };

/** Same visibility as the API: a cashier asking for someone else's sale gets a 404. */
export function useSale(code: string, saleId: string, initial?: SaleDto) {
  return useQuery({
    queryKey: qk.sale(code, saleId),
    queryFn: () => http.get<{ sale: SaleDto }>(`/b/${code}/sales/${saleId}`).then((r) => r.sale),
    initialData: initial, // straight from the POS: render the receipt without waiting for a round trip
    enabled: !!saleId, // the return screen before an invoice is looked up
  });
}

/** The full branch (address, phone) for the receipt header. Changes rarely. */
export function useBranchDetails(code: string) {
  return useQuery({
    queryKey: qk.branch(code),
    queryFn: () => http.get<{ branch: BranchDto }>(`/b/${code}`).then((r) => r.branch),
    staleTime: 10 * 60_000,
  });
}

export function useShiftSummary(code: string) {
  return useQuery({
    queryKey: qk.shift(code),
    queryFn: () =>
      http.get<{ summary: ShiftSummaryDto }>(`/b/${code}/sales/my-summary`).then((r) => r.summary),
  });
}

/** "124" → "GUL-000124"; a full number is just uppercased. */
export function toInvoiceNo(code: string, input: string): string {
  const v = input.trim().toUpperCase();
  return /^\d{1,6}$/.test(v) ? `${code}-${v.padStart(6, '0')}` : v;
}
