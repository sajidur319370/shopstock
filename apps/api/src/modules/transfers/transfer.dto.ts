import type { Types } from 'mongoose';
import {
  can,
  type TransferDirection,
  type TransferDto,
  type TransferRowDto,
  type TransferStatus,
} from '@shopstock/shared';
import type { BranchCtx } from '../../types/ctx';

type TransferLean = {
  _id: Types.ObjectId;
  transferNo: string;
  fromBranchId: Types.ObjectId;
  fromCode: string;
  toCode: string;
  status?: string | null;
  items: { productId: Types.ObjectId; sku: string; name: string; qty: number; unitCost?: number | null }[];
  note?: string | null;
  createdBy: Types.ObjectId;
  dispatchedBy?: Types.ObjectId | null;
  dispatchedAt?: Date | null;
  receivedBy?: Types.ObjectId | null;
  receivedAt?: Date | null;
  cancelledBy?: Types.ObjectId | null;
  cancelledAt?: Date | null;
  createdAt: Date;
};

const iso = (d?: Date | null) => (d ? d.toISOString() : null);
const direction = (t: { fromBranchId: Types.ObjectId }, ctx: BranchCtx): TransferDirection =>
  t.fromBranchId.equals(ctx.branchId) ? 'outgoing' : 'incoming';

/** Cost-aware like every mapper: unit costs and value only with inventory:viewCost. */
export function toTransferDto(
  t: TransferLean,
  ctx: BranchCtx,
  names: Map<string, string> = new Map(),
): TransferDto {
  const showCost = can(ctx.role, 'inventory:viewCost');
  const name = (id?: Types.ObjectId | null) => (id ? (names.get(String(id)) ?? '') : null);
  const dispatched = t.items.every((i) => i.unitCost != null);
  return {
    id: String(t._id),
    transferNo: t.transferNo,
    fromCode: t.fromCode,
    toCode: t.toCode,
    direction: direction(t, ctx),
    status: (t.status ?? 'pending') as TransferStatus,
    items: t.items.map((i) => ({
      productId: String(i.productId),
      sku: i.sku,
      name: i.name,
      qty: i.qty,
      ...(showCost && { unitCost: i.unitCost ?? null }),
    })),
    totals: {
      units: t.items.reduce((s, i) => s + i.qty, 0),
      ...(showCost && {
        value: dispatched ? t.items.reduce((s, i) => s + i.qty * (i.unitCost ?? 0), 0) : null,
      }),
    },
    note: t.note ?? '',
    createdByName: name(t.createdBy) ?? '',
    dispatchedByName: name(t.dispatchedBy),
    dispatchedAt: iso(t.dispatchedAt),
    receivedByName: name(t.receivedBy),
    receivedAt: iso(t.receivedAt),
    cancelledByName: name(t.cancelledBy),
    cancelledAt: iso(t.cancelledAt),
    createdAt: t.createdAt.toISOString(),
  };
}

type TransferRowLean = Pick<
  TransferLean,
  | '_id'
  | 'transferNo'
  | 'fromBranchId'
  | 'fromCode'
  | 'toCode'
  | 'status'
  | 'dispatchedAt'
  | 'receivedAt'
  | 'createdAt'
> & { items: { qty: number }[] };

export const toTransferRowDto = (t: TransferRowLean, ctx: BranchCtx): TransferRowDto => ({
  id: String(t._id),
  transferNo: t.transferNo,
  fromCode: t.fromCode,
  toCode: t.toCode,
  direction: direction(t, ctx),
  status: (t.status ?? 'pending') as TransferStatus,
  lineCount: t.items.length,
  units: t.items.reduce((s, i) => s + i.qty, 0),
  createdAt: t.createdAt.toISOString(),
  dispatchedAt: iso(t.dispatchedAt),
  receivedAt: iso(t.receivedAt),
});
