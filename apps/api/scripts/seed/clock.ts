/** UTC offset of a timezone at an instant, in ms (Dhaka: +6 h). */
function tzOffsetMs(at: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - at.getTime();
}

/**
 * The seed's clock. Every service reads time from ctx.now(), so a context built with `now: clock.now`
 * writes createdAt, businessDate and invoice dates as if it were that moment. Only moves FORWARD:
 * a movement written "earlier" after a later one would break reconciliation's latest-quantity check.
 */
export class FakeClock {
  private t: number;
  constructor(iso: string) {
    this.t = Date.parse(iso);
  }
  now = () => new Date(this.t);
  advanceMinutes(n: number) {
    this.t += n * 60_000;
  }
  /** Wall-clock time on a business date in the shop timezone, e.g. ('2026-09-01', '09:00', 'Asia/Dhaka'). */
  setLocal(day: string, hhmm: string, timeZone: string) {
    const guess = new Date(`${day}T${hhmm}:00Z`);
    const next = guess.getTime() - tzOffsetMs(guess, timeZone);
    if (next < this.t) throw new Error(`FakeClock can't go back: ${day} ${hhmm}`);
    this.t = next;
  }
}
