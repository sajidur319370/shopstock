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
