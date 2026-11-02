import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { LIMITS, type Discount } from '@shopstock/shared';

export interface CartLine {
  productId: string;
  name: string;
  sku: string;
  unitPrice: number; // display only: the server re-prices
  qty: number;
  discount: Discount | null;
  onHand: number; // hint only: the server decides
  problem?: string; // from server errors, e.g. "Only 1 left at GUL"
}

interface CartState {
  branchCode: string;
  /** THE client side of idempotency: made when a cart starts, kept across every retry. */
  clientSaleId: string;
  lines: CartLine[];
  cartDiscount: Discount | null;
  customer: { name: string; phone: string };
  selected: number; // index of the highlighted line, -1 = none
  add(p: { id: string; name: string; sku: string; price: number; onHand: number }): void;
  setQty(i: number, qty: number): void;
  remove(i: number): void;
  setLineDiscount(i: number, d: Discount | null): void;
  setCartDiscount(d: Discount | null): void;
  select(i: number): void;
  markProblems(problems: Record<string, string>): void;
  applyPrices(prices: Record<string, number>): void;
  /** A new cart → a NEW clientSaleId. Only after a confirmed success, or when the cashier clears it. */
  reset(branchCode: string): void;
}

/**
 * UUID v4. crypto.randomUUID only exists in secure contexts (https / localhost); a counter tablet on
 * plain http over the LAN gets the same thing built from crypto.getRandomValues.
 */
export function newClientSaleId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const fresh = (branchCode: string) => ({
  branchCode,
  clientSaleId: newClientSaleId(),
  lines: [] as CartLine[],
  cartDiscount: null,
  customer: { name: '', phone: '' },
  selected: -1,
});

const clampQty = (q: number) => Math.max(1, Math.min(Math.trunc(q) || 1, LIMITS.maxLineQty));

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      ...fresh(''),
      add: (p) =>
        set((s) => {
          const i = s.lines.findIndex((l) => l.productId === p.id);
          if (i >= 0) {
            // Scanning the same item again = one more of it.
            const lines = s.lines.map((l, j) =>
              j === i ? { ...l, qty: clampQty(l.qty + 1), onHand: p.onHand, problem: undefined } : l,
            );
            return { lines, selected: i };
          }
          const line: CartLine = {
            productId: p.id,
            name: p.name,
            sku: p.sku,
            unitPrice: p.price,
            qty: 1,
            discount: null,
            onHand: p.onHand,
          };
          return { lines: [...s.lines, line], selected: s.lines.length };
        }),
      setQty: (i, qty) =>
        set((s) => ({
          lines: s.lines.map((l, j) => (j === i ? { ...l, qty: clampQty(qty), problem: undefined } : l)),
        })),
      remove: (i) =>
        set((s) => {
          const lines = s.lines.filter((_, j) => j !== i);
          return { lines, selected: Math.min(s.selected, lines.length - 1) };
        }),
      setLineDiscount: (i, d) =>
        set((s) => ({ lines: s.lines.map((l, j) => (j === i ? { ...l, discount: d } : l)) })),
      setCartDiscount: (d) => set({ cartDiscount: d }),
      select: (i) => set({ selected: i }),
      markProblems: (problems) =>
        set((s) => ({ lines: s.lines.map((l) => ({ ...l, problem: problems[l.productId] })) })),
      applyPrices: (prices) =>
        set((s) => ({
          lines: s.lines.map((l) => ({ ...l, unitPrice: prices[l.productId] ?? l.unitPrice })),
        })),
      reset: (branchCode) => set(fresh(branchCode)),
    }),
    // FR-POS-12: a reload (or a crash) keeps the cart AND its clientSaleId, so Retry stays safe.
    { name: 'shopstock-cart', storage: createJSONStorage(() => sessionStorage) },
  ),
);

/** Which POS dialog is open. Separate from the cart: dialogs aren't worth persisting. */
interface PosUiState {
  payOpen: boolean;
  discountFor: 'cart' | number | null; // a line index, the whole cart, or closed
  helpOpen: boolean;
  setPayOpen(open: boolean): void;
  setDiscountFor(target: 'cart' | number | null): void;
  setHelpOpen(open: boolean): void;
}

export const usePosUi = create<PosUiState>()((set) => ({
  payOpen: false,
  discountFor: null,
  helpOpen: false,
  setPayOpen: (payOpen) => set({ payOpen }),
  setDiscountFor: (discountFor) => set({ discountFor }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
}));
