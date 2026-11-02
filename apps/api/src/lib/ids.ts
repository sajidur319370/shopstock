import { Types } from 'mongoose';
import { z } from 'zod';
import { objectIdSchema } from '@shopstock/shared';

export const oid = (s: string | Types.ObjectId) => (s instanceof Types.ObjectId ? s : new Types.ObjectId(s));
export const pad6 = (n: number) => String(n).padStart(6, '0');

/** `/:id` route params: a malformed id is a 400, never a CastError deeper down. */
export const idParams = z.object({ id: objectIdSchema });
