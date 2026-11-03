/** A controlled clock: 06:00 UTC = 12:00 in Dhaka, safely inside that business day. */
export const at = (day: string) => () => new Date(`${day}T06:00:00Z`);

/** Only the listed keys, in that order (to compare a response row with an expected row). */
export const pick = <T extends object, K extends keyof T>(o: T, keys: readonly K[]): Pick<T, K> =>
  Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

export const sum = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
