import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/api/client';

/**
 * Puts server errors on the right field: VALIDATION_ERROR details by field path, and known
 * error codes via `fieldByCode` (e.g. { EMAIL_TAKEN: 'email' }). Anything else goes to `root`.
 */
export function applyServerErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fieldByCode: Partial<Record<string, Path<T>>> = {},
) {
  if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
    for (const d of err.details as { field: string; message: string }[]) {
      setError(d.field as Path<T>, { message: d.message });
    }
    return;
  }
  const field = err instanceof ApiError ? fieldByCode[err.code] : undefined;
  const message = err instanceof Error ? err.message : 'Something went wrong';
  setError(field ?? ('root' as Path<T>), { message });
}

type LineDetail = { productId?: string; available?: number; current?: number };

/**
 * Stock errors come with details[] keyed by productId: put each one on ITS line, not in a toast.
 * Returns true if at least one line got an error (otherwise the caller shows a general message).
 */
export function applyLineErrors(
  err: unknown,
  lineProductIds: string[],
  setLineError: (index: number, field: 'qty' | 'unitCost', message: string) => void,
): boolean {
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return false;
  let any = false;
  for (const d of err.details as LineDetail[]) {
    const i = d.productId ? lineProductIds.indexOf(d.productId) : -1;
    if (i < 0) continue;
    any = true;
    if (err.code === 'INSUFFICIENT_STOCK') setLineError(i, 'qty', `Only ${d.available ?? 0} in stock`);
    else if (err.code === 'STOCK_CHANGED') setLineError(i, 'qty', `Stock is now ${d.current ?? 0}`);
    else if (err.code === 'UNIT_COST_REQUIRED')
      setLineError(i, 'unitCost', 'No stock here yet: enter a cost');
    else setLineError(i, 'qty', err.message);
  }
  return any;
}
