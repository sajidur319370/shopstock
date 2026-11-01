import { Schema } from 'mongoose';
import { DATE_ONLY, LIMITS } from '@shopstock/shared';

export const int = { validator: Number.isInteger, message: '{PATH} must be an integer' };

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
