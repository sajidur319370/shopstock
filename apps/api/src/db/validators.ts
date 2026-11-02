import mongoose from 'mongoose';

/**
 * The server checks the FINAL document of every write. Mongoose `min: 0` doesn't check the result
 * of `$inc` or of an update pipeline; this does. A rejected write fails with code 121, which the
 * error handler turns into 500 STOCK_INVARIANT (a code path skipped the conditional decrement).
 */
export const INVENTORY_VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['branchId', 'productId', 'quantity', 'avgCost'],
    properties: {
      quantity: { bsonType: ['int', 'long', 'double'], minimum: 0, multipleOf: 1 },
      avgCost: { bsonType: ['int', 'long', 'double'], minimum: 0 },
      reorderLevel: { bsonType: ['int', 'long', 'double'], minimum: 0 },
    },
  },
};

const NAMESPACE_EXISTS = 48;
const options = {
  validator: INVENTORY_VALIDATOR,
  validationLevel: 'strict',
  validationAction: 'error',
} as const;

/** Creates `inventory` with the validator, or applies it to the existing collection. Idempotent. */
export async function applyValidators() {
  const db = mongoose.connection.db!;
  const exists = await db.listCollections({ name: 'inventory' }).hasNext();
  if (!exists) {
    try {
      await db.createCollection('inventory', options);
      return;
    } catch (err) {
      // autoIndex may have created it between our check and here: fall through to collMod.
      if ((err as { code?: number }).code !== NAMESPACE_EXISTS) throw err;
    }
  }
  await db.command({ collMod: 'inventory', ...options });
}
