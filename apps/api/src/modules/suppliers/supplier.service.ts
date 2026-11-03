import type { Types } from 'mongoose';
import {
  LIMITS,
  type Page,
  type SupplierDetailDto,
  type SupplierDto,
  type SupplierInput,
  type SupplierListQuery,
  type UpdateSupplierInput,
} from '@shopstock/shared';
import { PurchaseOrder, Supplier } from '../../db/models';
import { listBranches } from '../../lib/cache';
import { decodeNameCursor, encodeNameCursor } from '../../lib/cursor';
import { notFound } from '../../lib/errors';
import { escapeRegex } from '../../lib/regex';
import type { Ctx } from '../../types/ctx';
import { toPORowDto } from '../purchasing/po.dto';

type SupplierLean = {
  _id: Types.ObjectId;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean | null;
};

export const toSupplierDto = (s: SupplierLean): SupplierDto => ({
  id: String(s._id),
  name: s.name,
  contactName: s.contactName ?? '',
  phone: s.phone ?? '',
  email: s.email ?? '',
  address: s.address ?? '',
  notes: s.notes ?? '',
  isActive: s.isActive ?? true,
});

/** A→Z with a name prefix search (FR-SUP-03); same name cursor as the product list. */
export async function listSuppliers(f: SupplierListQuery): Promise<Page<SupplierDto>> {
  const filter: Record<string, unknown> = {};
  if (f.active !== 'all') filter.isActive = f.active === 'true';
  const name: Record<string, unknown> = {};
  if (f.q) name.$regex = `^${escapeRegex(f.q.toLowerCase())}`;
  if (f.cursor) name.$gt = decodeNameCursor(f.cursor).nameLower;
  if (Object.keys(name).length) filter.nameLower = name;

  const rows = await Supplier.find(filter)
    .sort({ nameLower: 1 })
    .limit(LIMITS.pageSize + 1)
    .lean();
  const page = rows.slice(0, LIMITS.pageSize);
  const last = page.at(-1);
  return {
    items: page.map(toSupplierDto),
    nextCursor:
      rows.length > LIMITS.pageSize && last ? encodeNameCursor(last.nameLower, String(last._id)) : null,
  };
}

export async function createSupplier(input: SupplierInput): Promise<SupplierDto> {
  return toSupplierDto((await Supplier.create(input)).toObject()); // E11000 uniq_supplier_name → SUPPLIER_TAKEN
}

/** FR-SUP-02: deactivating stops NEW POs; existing POs carry on. */
export async function updateSupplier(id: Types.ObjectId, input: UpdateSupplierInput): Promise<SupplierDto> {
  const $set: Record<string, unknown> = { ...input };
  if (input.name) $set.nameLower = input.name.toLowerCase(); // updates skip pre('validate')
  const s = await Supplier.findByIdAndUpdate(
    id,
    { $set },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!s) throw notFound('Supplier not found.');
  return toSupplierDto(s);
}

/** Detail + the 10 most recent POs at the ACTOR's branches (a manager never sees another branch's POs). */
export async function getSupplier(ctx: Ctx, id: Types.ObjectId): Promise<SupplierDetailDto> {
  const s = await Supplier.findById(id).lean();
  if (!s) throw notFound('Supplier not found.');
  const [pos, branches] = await Promise.all([
    PurchaseOrder.find({ branchId: { $in: ctx.branchIds }, supplierId: s._id })
      .select(
        'branchId poNumber supplierId supplierName status items.orderedQty items.unitCost expectedDate createdAt',
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(10)
      .lean(),
    listBranches(),
  ]);
  const codeOf = new Map(branches.map((b) => [String(b._id), b.code]));
  return {
    supplier: toSupplierDto(s),
    recentPOs: pos.map((p) => ({ ...toPORowDto(p), branchCode: codeOf.get(String(p.branchId)) ?? '' })),
  };
}
