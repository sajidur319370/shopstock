import type { Types } from 'mongoose';
import {
  can,
  type PaymentMethod,
  type ReturnDto,
  type ReturnReason,
  type ReturnRowDto,
} from '@shopstock/shared';
import type { Ctx } from '../../types/ctx';

type ReturnLean = {
  _id: Types.ObjectId;
  returnNo: string;
  saleId: Types.ObjectId;
  invoiceNo: string;
  items: {
    saleLineId: Types.ObjectId;
    productId: Types.ObjectId;
    sku: string;
    name: string;
    qty: number;
    unitPrice: number;
    unitCost: number;
    net: number;
    tax: number;
    total: number;
    restock: boolean;
    writeOffCost: number;
  }[];
  // Mongoose types nested objects as optional; every field inside is `required`, so it's always there.
  totals?: {
    net: number;
    tax: number;
    total: number;
    costRestocked: number;
    writeOff: number;
    itemCount: number;
  } | null;
  refund?: { method: string; amount: number } | null;
  reason: string;
  note?: string | null;
  processedByName: string;
  businessDate: string;
  createdAt: Date;
};

/** NFR-SEC-14: costs (restocked value, write-off loss) only for Manager+ (inventory:viewCost). */
export function toReturnDto(r: ReturnLean, ctx: Pick<Ctx, 'role'>): ReturnDto {
  const showCost = can(ctx.role, 'inventory:viewCost');
  const { net, tax, total, itemCount, costRestocked, writeOff } = r.totals!;
  return {
    id: String(r._id),
    returnNo: r.returnNo,
    saleId: String(r.saleId),
    invoiceNo: r.invoiceNo,
    items: r.items.map((i) => ({
      saleLineId: String(i.saleLineId),
      productId: String(i.productId),
      sku: i.sku,
      name: i.name,
      qty: i.qty,
      unitPrice: i.unitPrice,
      net: i.net,
      tax: i.tax,
      total: i.total,
      restock: i.restock,
      ...(showCost && { unitCost: i.unitCost, writeOffCost: i.writeOffCost }),
    })),
    totals: { net, tax, total, itemCount, ...(showCost && { costRestocked, writeOff }) },
    refund: { method: r.refund!.method as PaymentMethod, amount: r.refund!.amount },
    reason: r.reason as ReturnReason,
    note: r.note ?? '',
    processedByName: r.processedByName,
    businessDate: r.businessDate,
    createdAt: r.createdAt.toISOString(),
  };
}

type ReturnRowLean = Pick<
  ReturnLean,
  | '_id'
  | 'returnNo'
  | 'saleId'
  | 'invoiceNo'
  | 'refund'
  | 'reason'
  | 'processedByName'
  | 'businessDate'
  | 'createdAt'
> & { totals?: { itemCount: number } | null };

export const toReturnRowDto = (r: ReturnRowLean): ReturnRowDto => ({
  id: String(r._id),
  returnNo: r.returnNo,
  saleId: String(r.saleId),
  invoiceNo: r.invoiceNo,
  itemCount: r.totals!.itemCount,
  refund: { method: r.refund!.method as PaymentMethod, amount: r.refund!.amount },
  reason: r.reason as ReturnReason,
  processedByName: r.processedByName,
  businessDate: r.businessDate,
  createdAt: r.createdAt.toISOString(),
});
