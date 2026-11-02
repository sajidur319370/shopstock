import type { Types } from 'mongoose';
import {
  can,
  type AdjustmentReason,
  type InventoryRowDto,
  type MovementDto,
  type MovementType,
  type RefType,
  type StockStatus,
  type Unit,
} from '@shopstock/shared';
import type { Ctx } from '../../types/ctx';

/** THE cost rule, in one place: cashiers never receive cost fields (NFR-SEC-14). */
export const seesCost = (ctx: Pick<Ctx, 'role'>) => can(ctx.role, 'inventory:viewCost');

export function stockStatus(row: { quantity: number; reorderLevel?: number | null } | null): StockStatus {
  if (!row) return 'not_stocked';
  if (row.quantity === 0) return 'out';
  const level = row.reorderLevel ?? 0;
  return level > 0 && row.quantity <= level ? 'low' : 'ok';
}

type ProductLean = {
  _id: Types.ObjectId;
  sku: string;
  name: string;
  unit?: string | null;
  categoryId: Types.ObjectId;
  reorderLevel?: number | null;
};
export type InventoryLean = {
  productId: Types.ObjectId;
  quantity: number;
  avgCost: number;
  reorderLevel?: number | null;
};

export function toInventoryRowDto(p: ProductLean, row: InventoryLean | null, ctx: Ctx): InventoryRowDto {
  const dto: InventoryRowDto = {
    productId: String(p._id),
    sku: p.sku,
    name: p.name,
    unit: (p.unit ?? 'pcs') as Unit,
    categoryId: String(p.categoryId),
    quantity: row?.quantity ?? 0,
    reorderLevel: row?.reorderLevel ?? p.reorderLevel ?? 0,
    status: stockStatus(row),
  };
  if (row && seesCost(ctx)) {
    dto.avgCost = row.avgCost;
    dto.value = row.quantity * row.avgCost;
  }
  return dto;
}

type MovementLean = {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  type: string;
  qtyChange: number;
  quantityAfter: number;
  unitCost: number;
  valueChange: number;
  refType: string;
  refId: Types.ObjectId;
  refNo: string;
  reason?: string | null;
  note?: string | null;
  userId: Types.ObjectId;
  businessDate: string;
  createdAt: Date;
};

export function toMovementDto(
  m: MovementLean,
  ctx: Ctx,
  names: { users: Map<string, string>; products?: Map<string, string> },
): MovementDto {
  const dto: MovementDto = {
    id: String(m._id),
    productId: String(m.productId),
    type: m.type as MovementType,
    qtyChange: m.qtyChange,
    quantityAfter: m.quantityAfter,
    refType: m.refType as RefType,
    refId: String(m.refId),
    refNo: m.refNo,
    reason: (m.reason ?? null) as AdjustmentReason | null,
    note: m.note ?? '',
    userName: names.users.get(String(m.userId)) ?? 'Unknown',
    businessDate: m.businessDate,
    createdAt: m.createdAt.toISOString(),
  };
  const productName = names.products?.get(String(m.productId));
  if (productName) dto.productName = productName;
  if (seesCost(ctx)) {
    dto.unitCost = m.unitCost;
    dto.valueChange = m.valueChange;
  }
  return dto;
}
