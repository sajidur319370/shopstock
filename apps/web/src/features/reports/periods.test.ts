import { describe, expect, it } from 'vitest';
import { presetOf, presetRange, validRange } from './periods';

describe('report periods', () => {
  it.each([
    ['today', '2026-10-26', '2026-10-26'],
    ['last7', '2026-10-20', '2026-10-26'],
    ['last30', '2026-09-27', '2026-10-26'],
    ['thisMonth', '2026-10-01', '2026-10-26'],
    ['lastMonth', '2026-09-01', '2026-09-30'],
  ] as const)('%s on 2026-10-26 → %s … %s', (p, from, to) => {
    expect(presetRange(p, '2026-10-26')).toEqual({ from, to });
  });

  it('last month across a year boundary, and a February', () => {
    expect(presetRange('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('lastMonth', '2028-03-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' }); // leap year
  });

  it('recognises a preset from its range, otherwise custom', () => {
    expect(presetOf('2026-09-27', '2026-10-26', '2026-10-26')).toBe('last30');
    expect(presetOf('2026-10-01', '2026-10-03', '2026-10-26')).toBe('custom');
  });

  it('the API rule: from ≤ to, at most 366 days', () => {
    expect(validRange('2026-10-01', '2026-10-01')).toBe(true);
    expect(validRange('2026-10-02', '2026-10-01')).toBe(false);
    expect(validRange('2025-01-01', '2026-01-01')).toBe(true); // 366 days
    expect(validRange('2025-01-01', '2026-01-02')).toBe(false); // 367
    expect(validRange('', '2026-01-02')).toBe(false);
  });
});
