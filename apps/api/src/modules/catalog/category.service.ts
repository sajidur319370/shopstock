import type { Types } from 'mongoose';
import { LIMITS } from '@shopstock/shared';
import { Category, Product } from '../../db/models';
import { conflict, notFound } from '../../lib/errors';
import { toCategoryDto } from './catalog.dto';

export async function listCategories() {
  return (await Category.find().sort({ nameLower: 1 }).lean()).map(toCategoryDto);
}

export async function createCategory(name: string) {
  if ((await Category.countDocuments()) >= LIMITS.categories) {
    throw conflict('CATEGORY_LIMIT', 'Too many categories.');
  }
  return toCategoryDto((await Category.create({ name })).toObject()); // E11000 uniq_category_name → CATEGORY_TAKEN
}

export async function renameCategory(id: Types.ObjectId, name: string) {
  // findByIdAndUpdate skips pre('validate'): set nameLower ourselves.
  const c = await Category.findByIdAndUpdate(
    id,
    { $set: { name, nameLower: name.toLowerCase() } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!c) throw notFound();
  return toCategoryDto(c);
}

export async function deleteCategory(id: Types.ObjectId) {
  if (await Product.exists({ categoryId: id })) {
    throw conflict('CATEGORY_IN_USE', 'Move or archive its products first.');
  }
  const r = await Category.deleteOne({ _id: id });
  if (r.deletedCount === 0) throw notFound();
}
