// Pure assistant rules (no database). Browser-safe via `@fulcra/core/rules`.
import type { BusinessHours } from '@fulcra/db/schema';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Weekday and "HH:MM" in a time zone (Africa/Lagos by default). */
export function localTime(now: Date, timeZone = 'Africa/Lagos'): { day: Weekday; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: get('weekday').toLowerCase().slice(0, 3) as Weekday,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/** Whether the business is open now. No hours set means always open. */
export function isOpen(
  hours: BusinessHours | null | undefined,
  now: Date,
  timeZone = 'Africa/Lagos',
): boolean {
  if (!hours) return true;
  const { day, time } = localTime(now, timeZone);
  return (hours[day] ?? []).some(
    ([from, to]) => TIME.test(from) && TIME.test(to) && time >= from && time < to,
  );
}

/** "Mon–Fri 09:00–18:00, Sat 10:00–14:00" style summary for the assistant and settings. */
export function describeHours(hours: BusinessHours | null | undefined): string {
  if (!hours) return 'Open every day, at any time';
  const label: Record<Weekday, string> = {
    mon: 'Mon',
    tue: 'Tue',
    wed: 'Wed',
    thu: 'Thu',
    fri: 'Fri',
    sat: 'Sat',
    sun: 'Sun',
  };
  const lines = WEEKDAYS.map((d) => {
    const slots = hours[d] ?? [];
    return `${label[d]} ${slots.length ? slots.map(([a, b]) => `${a}–${b}`).join(', ') : 'closed'}`;
  });
  return lines.join('; ');
}

/**
 * Naira amounts written in a message: "₦25,000", "N 4,500.50", "25,000 naira", "NGN 3000".
 * Returned in kobo. Plain numbers without a currency mark (quantities, sizes) are ignored.
 */
export function amountsInText(text: string): number[] {
  const found: number[] = [];
  const number = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?`;
  const patterns = [
    new RegExp(String.raw`(?:₦|\bNGN\s?|\bN(?=\s?\d))\s?${number}(k)?`, 'gi'),
    new RegExp(String.raw`${number}(k)?\s?(?:naira|NGN)\b`, 'gi'),
  ];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      const whole = Number(m[1]!.replace(/,/g, ''));
      const fraction = Number((m[2] ?? '').padEnd(2, '0'));
      const thousands = m[3] ? 1000 : 1;
      found.push((whole * 100 + fraction) * thousands);
    }
  }
  return [...new Set(found)];
}

/** Every kobo amount (any number in the data) a reply may repeat. */
export function amountsInData(data: unknown, into = new Set<number>()): Set<number> {
  if (typeof data === 'number' && Number.isInteger(data) && data >= 0) into.add(data);
  else if (typeof data === 'string') amountsInText(data).forEach((a) => into.add(a));
  else if (Array.isArray(data)) data.forEach((d) => amountsInData(d, into));
  else if (data && typeof data === 'object')
    Object.values(data).forEach((d) => amountsInData(d, into));
  return into;
}

/**
 * Amounts in an assistant reply that did not come from the database (tool results or earlier
 * messages already checked). Any amount listed here means the reply must not be sent.
 */
export function unverifiedAmounts(reply: string, allowedKobo: Set<number>): number[] {
  return amountsInText(reply).filter((amount) => !allowedKobo.has(amount));
}
