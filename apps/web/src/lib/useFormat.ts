import { formatMoney } from '@shopstock/shared';
import { useActor } from '@/features/auth/useActor';

/** Money in the shop currency, dates in the SHOP timezone (not the browser's). */
export function useFormat() {
  const { settings } = useActor();
  const dateTime = new Intl.DateTimeFormat(undefined, {
    timeZone: settings.timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return {
    money: (minor: number) => formatMoney(minor, settings.currency),
    dateTime: (iso: string) => dateTime.format(new Date(iso)),
  };
}
