import type { Types } from 'mongoose';
import type { PODto, PORowDto, PoStatus } from '@shopstock/shared';

type POLineLean = {
  productId: Types.ObjectId;
  sku: string;
  name: string;
  orderedQty: number;
  receivedQty?: number | null;
  unitCost: number;
};

type POLean = {
  _id: Types.ObjectId;
  poNumber: string;
  supplierId: Types.ObjectId;
  supplierName: string;
  status?: string | null;
  items: POLineLean[];
  receipts: {
    _id: Types.ObjectId;
    receivedAt: Date;
    receivedByName: string;
    lines: { productId: Types.ObjectId; qty: number; unitCost: number }[];
    note?: string | null;
  }[];
  expectedDate?: string | null;
  notes?: string | null;
  createdAt: Date;
  orderedAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  closedAt?: Date | null;
};

const iso = (d?: Date | null) => (d ? d.toISOString() : null);
const orderedValue = (items: Pick<POLineLean, 'orderedQty' | 'unitCost'>[]) =>
  items.reduce((s, i) => s + i.orderedQty * i.unitCost, 0);

/** Derived numbers (remaining, totals) are computed here, never stored: they can't drift. */
export function toPODto(po: POLean): PODto {
  return {
    id: String(po._id),
    poNumber: po.poNumber,
    supplierId: String(po.supplierId),
    supplierName: po.supplierName,
    status: (po.status ?? 'draft') as PoStatus,
    items: po.items.map((i) => {
      const receivedQty = i.receivedQty ?? 0;
      return {
        productId: String(i.productId),
        sku: i.sku,
        name: i.name,
        orderedQty: i.orderedQty,
        receivedQty,
        remaining: i.orderedQty - receivedQty,
        unitCost: i.unitCost,
      };
    }),
    receipts: po.receipts.map((r) => ({
      id: String(r._id),
      receivedAt: r.receivedAt.toISOString(),
      receivedByName: r.receivedByName,
      lines: r.lines.map((l) => ({ productId: String(l.productId), qty: l.qty, unitCost: l.unitCost })),
      note: r.note ?? '',
    })),
    expectedDate: po.expectedDate ?? null,
    notes: po.notes ?? '',
    createdAt: po.createdAt.toISOString(),
    orderedAt: iso(po.orderedAt),
    completedAt: iso(po.completedAt),
    cancelledAt: iso(po.cancelledAt),
    closedAt: iso(po.closedAt),
    totals: {
      orderedValue: orderedValue(po.items),
      // what actually arrived, at the cost on each receipt line (an override wins over the PO cost)
      receivedValue: po.receipts.flatMap((r) => r.lines).reduce((s, l) => s + l.qty * l.unitCost, 0),
    },
  };
}

type PORowLean = Pick<
  POLean,
  '_id' | 'poNumber' | 'supplierId' | 'supplierName' | 'status' | 'expectedDate' | 'createdAt'
> & { items: Pick<POLineLean, 'orderedQty' | 'unitCost'>[] };

export const toPORowDto = (po: PORowLean): PORowDto => ({
  id: String(po._id),
  poNumber: po.poNumber,
  supplierId: String(po.supplierId),
  supplierName: po.supplierName,
  status: (po.status ?? 'draft') as PoStatus,
  lineCount: po.items.length,
  orderedValue: orderedValue(po.items),
  expectedDate: po.expectedDate ?? null,
  createdAt: po.createdAt.toISOString(),
});
