import type { Model } from 'mongoose';
import { conflict, notFound } from './errors';

/** After a compare-and-set that matched nothing: was the document missing (404) or in the wrong state (409)? */
export async function notFoundOrInvalidState(
  // Any model with a `status` field (POs today, transfers on Day 17): Mongoose's Model generics don't unify.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>,
  filter: Record<string, unknown>,
) {
  const doc = await model.findOne(filter).select('status').lean<{ status: string } | null>();
  return doc
    ? conflict('INVALID_STATE', `Not allowed while ${doc.status.replace('_', ' ')}.`, { status: doc.status })
    : notFound();
}
