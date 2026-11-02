import type { Types } from 'mongoose';
import { can, type Discount, type PaymentMethod, type SaleDto, type SaleRowDto } from '@shopstock/shared';
import type { Ctx } from '../../types/ctx';

type StoredDiscount = { type: string; bps?: number | null; amount?: number | null } | null | undefined;

/** Stored as { type, bps, amount } with nulls → the shared union type. */
const normalizeDiscount = (d: StoredDiscount): Discount | null =>
  !d
    ? null
    : d.type === 'percent'
      ? { type: 'percent', bps: d.bps ?? 0 }
      : { type: 'amount', amount: d.amount ?? 0 };

type SaleLean = {
  _id: Types.ObjectId;
  invoiceNo: string;
  branchCode: string;
  cashierId: Types.ObjectId;
  cashierName: string;
  items: {
    _id: Types.ObjectId;
    productId: Types.ObjectId;
    sku: string;
    name: string;
    qty: number;
    unitPrice: number;
    unitCost: number;
    discount?: StoredDiscount;
    lineDiscount: number;
    cartShare: number;
    net: number;
    tax: number;
    total: number;
    returnedQty?: number | null;
  }[];
  discount?: StoredDiscount;
  taxRateBps: number;
  // Mongoose types nested objects as optional; every field inside is `required`, so it's always there.
  totals?: {
    subtotal: number;
    discount: number;
    net: number;
    tax: number;
    total: number;
    cost: number;
    itemCount: number;
  } | null;
  payments: { method: string; amount: number; reference?: string | null }[];
  change: number;
  customer?: { name?: string | null; phone?: string | null } | null;
  note?: string | null;
  returnStatus?: string | null;
  printCount?: number | null;
  businessDate: string;
  createdAt: Date;
};

/** NFR-SEC-14: unit costs and the sale's total cost only for Manager+ (inventory:viewCost). */
export function toSaleDto(s: SaleLean, ctx: Pick<Ctx, 'role'>): SaleDto {
  const showCost = can(ctx.role, 'inventory:viewCost');
  const { subtotal, discount, net, tax, total, itemCount, cost } = s.totals!;
  return {
    id: String(s._id),
    invoiceNo: s.invoiceNo,
    branchCode: s.branchCode,
    cashierId: String(s.cashierId),
    cashierName: s.cashierName,
    items: s.items.map((i) => ({
      id: String(i._id),
      productId: String(i.productId),
      sku: i.sku,
      name: i.name,
      qty: i.qty,
      unitPrice: i.unitPrice,
      discount: normalizeDiscount(i.discount),
      lineDiscount: i.lineDiscount,
      cartShare: i.cartShare,
      net: i.net,
      tax: i.tax,
      total: i.total,
      returnedQty: i.returnedQty ?? 0,
      ...(showCost && { unitCost: i.unitCost }),
    })),
    discount: normalizeDiscount(s.discount),
    taxRateBps: s.taxRateBps,
    totals: { subtotal, discount, net, tax, total, itemCount, ...(showCost && { cost }) },
    payments: s.payments.map((p) => ({
      method: p.method as PaymentMethod,
      amount: p.amount,
      reference: p.reference ?? '',
    })),
    change: s.change,
    customer: { name: s.customer?.name ?? '', phone: s.customer?.phone ?? '' },
    note: s.note ?? '',
    returnStatus: (s.returnStatus ?? 'none') as SaleDto['returnStatus'],
    printCount: s.printCount ?? 0,
    businessDate: s.businessDate,
    createdAt: s.createdAt.toISOString(),
  };
}

type SaleRowLean = Pick<
  SaleLean,
  '_id' | 'invoiceNo' | 'cashierName' | 'returnStatus' | 'businessDate' | 'createdAt'
> & {
  totals?: { total: number; itemCount: number } | null;
  payments: { method: string }[];
};

/** History row: no lines, no cost. `methods` de-duplicated (a split cash + cash is impossible, but cheap to guard). */
export const toSaleRowDto = (s: SaleRowLean): SaleRowDto => ({
  id: String(s._id),
  invoiceNo: s.invoiceNo,
  cashierName: s.cashierName,
  total: s.totals!.total,
  itemCount: s.totals!.itemCount,
  methods: [...new Set(s.payments.map((p) => p.method as PaymentMethod))],
  returnStatus: (s.returnStatus ?? 'none') as SaleRowDto['returnStatus'],
  businessDate: s.businessDate,
  createdAt: s.createdAt.toISOString(),
});
