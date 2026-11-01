import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError, badRequest, notFound } from '../lib/errors';

/** E11000 duplicate-key errors carry the index name → API error (schema.md §18). */
const DUPLICATE_KEY: Record<string, { status: number; code: string }> = {
  uniq_email: { status: 409, code: 'EMAIL_TAKEN' },
  uniq_branch_code: { status: 409, code: 'BRANCH_CODE_TAKEN' },
  uniq_category_name: { status: 409, code: 'CATEGORY_TAKEN' },
  uniq_sku: { status: 409, code: 'SKU_TAKEN' },
  uniq_barcode: { status: 409, code: 'BARCODE_TAKEN' },
  uniq_supplier_name: { status: 409, code: 'SUPPLIER_TAKEN' },
  uniq_inventory_row: { status: 409, code: 'RETRY' },
};

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof z.ZodError) {
    return badRequest(
      'VALIDATION_ERROR',
      'Some fields are invalid.',
      err.issues.map((i) => ({ field: i.path.join('.'), issue: i.code, message: i.message })),
    );
  }
  if (err instanceof mongoose.Error.CastError) return badRequest('INVALID_ID', 'Invalid id.');
  if (err instanceof mongoose.Error.ValidationError) return badRequest('VALIDATION_ERROR', err.message);

  const e = err as { code?: number; message?: string; type?: string };
  if (e.code === 11000) {
    const index = /index: (\S+)/.exec(e.message ?? '')?.[1];
    const mapped = index ? DUPLICATE_KEY[index] : undefined;
    if (mapped) return new AppError(mapped.status, mapped.code);
  }
  // 121 = DocumentValidationFailure: the inventory $jsonSchema caught negative stock (Day 8).
  if (e.code === 121) return new AppError(500, 'STOCK_INVARIANT', 'Something went wrong.');
  if (e.type === 'entity.parse.failed') return badRequest('INVALID_JSON', 'Request body is not valid JSON.');
  if (e.type === 'entity.too.large')
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');

  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appErr = toAppError(err);
  if (appErr.status >= 500) req.log?.error({ err }, 'unhandled error'); // real error only in logs
  res.status(appErr.status).json({
    error: { code: appErr.code, message: appErr.message, details: appErr.details, requestId: req.id },
  });
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound('Route not found.'));
