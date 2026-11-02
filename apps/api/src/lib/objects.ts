const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/**
 * { a: 1, caps: { cashier: 500 } } → { a: 1, 'caps.cashier': 500 }.
 * `$set` with a nested object REPLACES it (and drops siblings); dotted paths update only what was sent.
 */
export function flattenForSet(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) Object.assign(out, flattenForSet(value, path));
    else out[path] = value;
  }
  return out;
}

/** Copies only the listed keys that are actually present (undefined is skipped). */
export function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
