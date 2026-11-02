import { badRequest } from './errors';

/** Name cursor for A→Z lists. The (createdAt, _id) cursor from queries.md §1.3 joins on Day 8. */
export const encodeNameCursor = (nameLower: string, id: string) =>
  Buffer.from(JSON.stringify([nameLower, id])).toString('base64url');

export function decodeNameCursor(c: string): { nameLower: string; id: string } {
  try {
    const [nameLower, id] = JSON.parse(Buffer.from(c, 'base64url').toString()) as [unknown, unknown];
    if (typeof nameLower !== 'string' || typeof id !== 'string') throw new Error('shape');
    return { nameLower, id };
  } catch {
    throw badRequest('INVALID_CURSOR', 'Invalid page cursor.'); // a tampered cursor is a 400, not a 500
  }
}
