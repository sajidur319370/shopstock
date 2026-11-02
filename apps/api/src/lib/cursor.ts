import { Types } from 'mongoose';
import { badRequest } from './errors';

const invalid = () => badRequest('INVALID_CURSOR', 'Invalid page cursor.'); // a tampered cursor is a 400, not a 500

/** Name cursor for A→Z lists. */
export const encodeNameCursor = (nameLower: string, id: string) =>
  Buffer.from(JSON.stringify([nameLower, id])).toString('base64url');

export function decodeNameCursor(c: string): { nameLower: string; id: string } {
  try {
    const [nameLower, id] = JSON.parse(Buffer.from(c, 'base64url').toString()) as [unknown, unknown];
    if (typeof nameLower !== 'string' || typeof id !== 'string') throw new Error('shape');
    return { nameLower, id };
  } catch {
    throw invalid();
  }
}

/** (createdAt, _id) cursor for newest-first feeds (queries.md §1.3). */
export const encodeCursor = (d: { createdAt: Date; _id: Types.ObjectId }) =>
  Buffer.from(JSON.stringify({ t: d.createdAt.toISOString(), id: String(d._id) })).toString('base64url');

export function decodeCursor(c: string): { t: Date; id: Types.ObjectId } {
  try {
    const { t, id } = JSON.parse(Buffer.from(c, 'base64url').toString()) as { t: unknown; id: unknown };
    const date = new Date(String(t));
    if (Number.isNaN(date.getTime()) || typeof id !== 'string' || !Types.ObjectId.isValid(id))
      throw new Error();
    return { t: date, id: new Types.ObjectId(id) };
  } catch {
    throw invalid();
  }
}

/** Filter for "older than the cursor" on a (createdAt desc, _id desc) index. */
export const olderThan = (c: { t: Date; id: Types.ObjectId }) => ({
  $or: [{ createdAt: { $lt: c.t } }, { createdAt: c.t, _id: { $lt: c.id } }],
});
