import { Schema } from 'mongoose';
import { DATE_ONLY, LIMITS } from '@shopstock/shared';

/**
 * Integer check. `null` passes on purpose: Mongoose runs custom validators on null, and presence is
 * `required`'s job. Without this, optional `default: null` fields (a sale discount's unused `bps` or
 * `amount`) failed validation, so every discounted sale was rejected. Required fields still reject null.
 */
export const int = {
  validator: (v: unknown) => v == null || Number.isInteger(v),
  message: '{PATH} must be an integer',
};

/** Integer money in minor units. */
export const money = (required = true) => ({
  type: Number,
  required,
  min: 0,
  max: LIMITS.maxMoney,
  validate: int,
});

/** Integer quantity. */
export const qty = (min = 1, max: number = LIMITS.maxDocQty) => ({
  type: Number,
  required: true,
  min,
  max,
  validate: int,
});

export const dateOnly = (required = true) => ({ type: String, required, match: DATE_ONLY });

export const ref = (model: string, required = true) => ({
  type: Schema.Types.ObjectId,
  ref: model,
  required,
});
