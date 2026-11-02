import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Product } from '../src/db/models';

/** TR-10: hot queries must use an index and never sort in memory. Grows with every hot query. */
const assertIndexed = (plan: unknown) => {
  const text = JSON.stringify(plan);
  expect(text).toContain('IXSCAN');
  expect(text).not.toContain('COLLSCAN');
  expect(text).not.toMatch(/"stage":"SORT"/); // the sort comes from the index
};

describe('index usage', () => {
  it('prefix search uses { isActive, nameLower }', async () => {
    const plan = await Product.find({ isActive: true, nameLower: { $regex: '^soy' } })
      .sort({ nameLower: 1 })
      .explain('queryPlanner');
    assertIndexed(plan);
  });

  it('list by category uses { categoryId, nameLower }', async () => {
    const plan = await Product.find({ categoryId: new Types.ObjectId() })
      .sort({ nameLower: 1 })
      .explain('queryPlanner');
    assertIndexed(plan);
  });

  it('barcode and SKU lookups are single index seeks', async () => {
    assertIndexed(
      await Product.findOne({ barcode: '8941100500017', isActive: true }).explain('queryPlanner'),
    );
    assertIndexed(await Product.findOne({ sku: 'RICE-5KG', isActive: true }).explain('queryPlanner'));
  });
});
