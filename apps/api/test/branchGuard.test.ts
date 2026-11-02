import mongoose, { Schema, Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { branchGuard } from '../src/db/plugins/branchGuard';

// No branch-owned collection exists yet (inventory arrives on Day 8): test with throwaway models.
const single = new Schema({ branchId: Schema.Types.ObjectId, productId: Schema.Types.ObjectId });
single.plugin(branchGuard);
const Single = mongoose.model('GuardTestSingle', single);

const pair = new Schema({
  fromBranchId: Schema.Types.ObjectId,
  toBranchId: Schema.Types.ObjectId,
  note: String,
});
pair.plugin(branchGuard, { keys: ['fromBranchId', 'toBranchId'] });
const Pair = mongoose.model('GuardTestPair', pair);

describe('branchGuard', () => {
  const b = new Types.ObjectId();

  it('throws without a branch key', async () => {
    await expect(Single.find({ productId: new Types.ObjectId() })).rejects.toThrow(/without branchId/);
    await expect(Single.findById(new Types.ObjectId())).rejects.toThrow(/without branchId/); // becomes findOne({ _id })
    await expect(Single.countDocuments({})).rejects.toThrow();
  });

  it('guards every write path too: updateOne, updateMany, deleteOne, deleteMany', async () => {
    const p = new Types.ObjectId();
    await expect(Single.updateOne({ productId: p }, { $set: { productId: p } })).rejects.toThrow(/updateOne/);
    await expect(Single.updateMany({ productId: p }, { $set: { productId: p } })).rejects.toThrow(
      /updateMany/,
    );
    await expect(Single.deleteOne({ productId: p })).rejects.toThrow(/deleteOne/);
    await expect(Single.deleteMany({})).rejects.toThrow(/deleteMany/);
    await expect(Single.updateOne({ branchId: b }, { $set: { productId: p } })).resolves.toBeTruthy();
  });

  it('allows scoped queries, including $in', async () => {
    await expect(Single.find({ branchId: b })).resolves.toEqual([]);
    await expect(Single.find({ branchId: { $in: [b] } })).resolves.toEqual([]);
  });

  it('two-key models: either key, or an $or where EVERY branch is scoped', async () => {
    await expect(Pair.find({ toBranchId: b })).resolves.toEqual([]);
    await expect(Pair.find({ $or: [{ fromBranchId: b }, { toBranchId: b }] })).resolves.toEqual([]);
    await expect(Pair.find({ $or: [{ fromBranchId: b }, { note: 'x' }] })).rejects.toThrow();
  });

  it('allows a named bypass', async () => {
    await expect(
      Single.exists({ productId: new Types.ObjectId() }).setOptions({ skipBranchCheck: 'test' }),
    ).resolves.toBeNull();
  });

  it('aggregations must start with $match on the branch key', async () => {
    await expect(Single.aggregate([{ $match: { productId: new Types.ObjectId() } }])).rejects.toThrow(
      /must start with/,
    );
    await expect(Single.aggregate([{ $match: { branchId: b } }])).resolves.toEqual([]);
  });
});
