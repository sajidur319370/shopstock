export interface Currency {
  code: string; // 'BDT'
  symbol: string; // '৳'
  minorUnits: number; // 2
}

/**
 * Parses a typed amount into integer minor units WITHOUT floating point:
 * '12.5' → 1250, '1,234.50' → 123450, '12.345' → null (too many decimals), 'abc' → null.
 */
export function toMinor(input: string, minorUnits: number): number | null {
  const s = input.trim().replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const whole = m[1]!;
  const frac = m[2] ?? '';
  if (frac.length > minorUnits) return null;
  const value = Number(whole) * 10 ** minorUnits + Number(frac.padEnd(minorUnits, '0') || '0');
  return Number.isSafeInteger(value) ? value : null;
}

/** 1250 → '12.50' (no symbol, no grouping): for input fields. */
export function fromMinor(minor: number, minorUnits: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const base = 10 ** minorUnits;
  const whole = Math.floor(abs / base);
  if (minorUnits === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(abs % base).padStart(minorUnits, '0')}`;
}

/** 155000 → '৳1,550.00' */
export function formatMoney(minor: number, c: Currency): string {
  const [whole, frac] = fromMinor(Math.abs(minor), c.minorUnits).split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${minor < 0 ? '-' : ''}${c.symbol}${grouped}${frac ? `.${frac}` : ''}`;
}

/** 1000 → '10%', 750 → '7.5%' */
export const formatBps = (bps: number) => `${(bps / 100).toString()}%`;

/**
 * round_half_up(a / b) for integers a ≥ 0, b > 0, without floats (MongoDB's $round is half-to-even,
 * so averages are divided here, not in a pipeline). Returns 0 when b is 0. A signed value (a margin
 * that is a loss) is the caller's job: sign × divRoundHalfUp(|a|, b).
 */
export function divRoundHalfUp(a: number, b: number): number {
  if (b === 0) return 0;
  return Math.floor((2 * a + b) / (2 * b));
}
