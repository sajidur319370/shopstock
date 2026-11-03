import { describe, expect, it } from 'vitest';
import { divRoundHalfUp, formatMoney, fromMinor, toMinor } from '../src/money';
import { addMonths, daysBetween, toBusinessDate } from '../src/dates';

const BDT = { code: 'BDT', symbol: '৳', minorUnits: 2 };

describe('money', () => {
  it.each([
    ['12.5', 1250],
    ['12.50', 1250],
    ['0.05', 5],
    ['1,234.50', 123450],
    ['7', 700],
    ['1.15', 115],
  ])('toMinor(%s) = %i', (input, out) => expect(toMinor(input, 2)).toBe(out));

  it.each(['12.345', 'abc', '-5', '1.2.3', ''])('toMinor(%s) = null', (input) =>
    expect(toMinor(input, 2)).toBeNull(),
  );

  it('formats', () => {
    expect(formatMoney(155000, BDT)).toBe('৳1,550.00');
    expect(formatMoney(5, BDT)).toBe('৳0.05');
    expect(fromMinor(1250, 2)).toBe('12.50');
    expect(formatMoney(1500, { code: 'JPY', symbol: '¥', minorUnits: 0 })).toBe('¥1,500');
  });
});

describe('dates', () => {
  it('uses the shop timezone (AC-RPT-02)', () => {
    expect(toBusinessDate(new Date('2026-10-31T17:30:00Z'), 'Asia/Dhaka')).toBe('2026-10-31'); // 23:30 local
    expect(toBusinessDate(new Date('2026-10-31T18:30:00Z'), 'Asia/Dhaka')).toBe('2026-11-01'); // 00:30 local
  });
  it('calendar math', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
  });
});

describe('divRoundHalfUp', () => {
  it.each([
    [63525, 2, 31763], // queries.md §22.2, DHN 10-03: .5 rounds UP (half-to-even would give 31762)
    [5, 2, 3],
    [4, 3, 1],
    [5, 3, 2],
    [55500, 2, 27750],
    [0, 7, 0],
    [7, 0, 0], // no sales yet: an average of 0, not NaN
  ])('%i / %i → %i', (a, b, expected) => {
    expect(divRoundHalfUp(a, b)).toBe(expected);
  });

  it('matches exact rational rounding for many pairs (no float drift)', () => {
    for (let b = 1; b <= 50; b++) {
      for (let a = 0; a <= 500; a++) {
        const exact = Number((BigInt(2 * a + b) / BigInt(2 * b)).toString());
        expect(divRoundHalfUp(a, b)).toBe(exact);
      }
    }
  });
});
