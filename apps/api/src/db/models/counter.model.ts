import { Schema, model } from 'mongoose';
import { int } from '../fields';

const counterSchema = new Schema(
  {
    _id: { type: String, required: true }, // 'sale:<branchId>' | 'return:<branchId>' | 'adj:<branchId>' | 'po:2026' | 'tr:2026'
    seq: { type: Number, required: true, default: 0, min: 0, validate: int },
  },
  { collection: 'counters', versionKey: false },
);

export const Counter = model('Counter', counterSchema);
