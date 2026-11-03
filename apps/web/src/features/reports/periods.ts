import { addDaysToDate, addMonths, daysBetween, LIMITS } from '@shopstock/shared';

export const PRESETS = ['today', 'last7', 'last30', 'thisMonth', 'lastMonth'] as const;
export type Preset = (typeof PRESETS)[number];

export const PRESET_LABEL: Record<Preset | 'custom', string> = {
  today: 'Today',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  custom: 'Custom',
};

/**
 * A preset as business dates, from the SHOP's today (toBusinessDate(new Date(), tz)), never the
 * browser's local date: a manager abroad still reads the shop's days.
 */
export function presetRange(p: Preset, today: string): { from: string; to: string } {
  const month = today.slice(0, 7);
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: addDaysToDate(today, -6), to: today };
    case 'last30':
      return { from: addDaysToDate(today, -29), to: today };
    case 'thisMonth':
      return { from: `${month}-01`, to: today };
    case 'lastMonth':
      return { from: `${addMonths(month, -1)}-01`, to: addDaysToDate(`${month}-01`, -1) };
  }
}

/** Which preset a range is (for the select), or 'custom'. */
export const presetOf = (from: string, to: string, today: string): Preset | 'custom' =>
  PRESETS.find((p) => {
    const r = presetRange(p, today);
    return r.from === from && r.to === to;
  }) ?? 'custom';

/** The API's rule, checked before sending: 1–366 days, from ≤ to. */
export const validRange = (from: string, to: string) =>
  !!from && !!to && from <= to && daysBetween(from, to) + 1 <= LIMITS.reportMaxDays;
