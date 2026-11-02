import type { Types } from 'mongoose';
import type { CategoryDto, ProductDto, Unit } from '@shopstock/shared';

/** Every product field a client may see. Lists, search and detail all load this. */
export const PRODUCT_CARD =
  '_id sku barcode name nameLower categoryId price unit reorderLevel isActive priceUpdatedAt';

type CategoryLike = { _id: Types.ObjectId; name: string };
export const toCategoryDto = (c: CategoryLike): CategoryDto => ({ id: String(c._id), name: c.name });

type ProductLike = {
  _id: Types.ObjectId;
  sku: string;
  barcode?: string | null;
  name: string;
  categoryId: Types.ObjectId;
  price: number;
  unit?: string | null;
  reorderLevel?: number | null;
  isActive: boolean;
  priceUpdatedAt?: Date | null;
};

export const toProductDto = (p: ProductLike): ProductDto => ({
  id: String(p._id),
  sku: p.sku,
  barcode: p.barcode ?? null,
  name: p.name,
  categoryId: String(p.categoryId),
  price: p.price,
  unit: (p.unit ?? 'pcs') as Unit,
  reorderLevel: p.reorderLevel ?? 0,
  isActive: p.isActive,
  priceUpdatedAt: p.priceUpdatedAt ? p.priceUpdatedAt.toISOString() : null,
});
