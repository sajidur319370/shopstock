import type { ClientSession, Types } from 'mongoose';
import { Counter } from './models';

export const counterKeys = {
  sale: (branchId: Types.ObjectId) => `sale:${branchId}`,
  return: (branchId: Types.ObjectId) => `return:${branchId}`,
  adjustment: (branchId: Types.ObjectId) => `adj:${branchId}`,
  po: (year: number) => `po:${year}`,
  transfer: (year: number) => `tr:${year}`,
};

/** Branch counters exist from the start, so the first sale never races on an upsert (data-model.md §13). */
export async function createBranchCounters(branchId: Types.ObjectId, session: ClientSession) {
  await Counter.insertMany(
    [counterKeys.sale(branchId), counterKeys.return(branchId), counterKeys.adjustment(branchId)].map(
      (_id) => ({ _id, seq: 0 }),
    ),
    { session },
  );
}

export async function nextSeq(key: string, session?: ClientSession): Promise<number> {
  const c = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session },
  ).lean();
  return c!.seq;
}
