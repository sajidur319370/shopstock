/** The calendar date of an instant in a timezone, as 'YYYY-MM-DD' (en-CA formats that way). */
export function toBusinessDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

const toUtc = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));

/** Whole days from a to b ('2026-10-01' → '2026-10-31' = 30). */
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);

export function addDaysToDate(day: string, n: number): string {
  return new Date(toUtc(day) + n * 86_400_000).toISOString().slice(0, 10);
}

/** '2026-10' + 1 → '2026-11'; '2026-01' − 1 → '2025-12' */
export function addMonths(month: string, n: number): string {
  const total = +month.slice(0, 4) * 12 + (+month.slice(5, 7) - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}
