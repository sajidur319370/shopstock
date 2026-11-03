/**
 * Small deterministic PRNG: the same seed always gives the same sequence. In src/ (not test/) because
 * the Day 20 seed script uses it too. NOT for anything security-related.
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type Rand = () => number;
/** An integer in [min, max], both ends included. */
export const randInt = (r: Rand, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
export const pick = <T>(r: Rand, a: readonly T[]) => a[Math.floor(r() * a.length)]!;
export const chance = (r: Rand, p: number) => r() < p;
