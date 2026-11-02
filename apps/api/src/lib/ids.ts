import { Types } from 'mongoose';
import { z } from 'zod';
import { objectIdSchema } from '@shopstock/shared';

export const oid = (s: string | Types.ObjectId) => (s instanceof Types.ObjectId ? s : new Types.ObjectId(s));
export const pad6 = (n: number) => String(n).padStart(6, '0');

/** Keeps the FIRST row per _id, in order (so earlier, better matches win). */
export function uniqueById<T extends { _id: Types.ObjectId }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = String(r._id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const isDefined = <T>(v: T | null | undefined): v is T => v != null;

/** `/:id` route params: a malformed id is a 400, never a CastError deeper down. */
export const idParams = z.object({ id: objectIdSchema });
