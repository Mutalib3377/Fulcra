/** Browser-safe rules for the owner's assistant (O1). */

/** Owner messages a month (fair use; each one is an AI call). */
export const OWNER_MESSAGES_PER_MONTH = 300;
export const TRIAL_OWNER_MESSAGES = 50;
/** A change waits this long for the owner's YES. */
export const PENDING_ACTION_MINUTES = 10;

export const SALES_PERIODS = [
  'today',
  'yesterday',
  'this_week',
  'this_month',
  'last_7_days',
  'last_30_days',
] as const;
export type SalesPeriod = (typeof SALES_PERIODS)[number];

export const SALES_PERIOD_LABELS: Record<SalesPeriod, string> = {
  today: 'today',
  yesterday: 'yesterday',
  this_week: 'this week',
  this_month: 'this month',
  last_7_days: 'in the last 7 days',
  last_30_days: 'in the last 30 days',
};

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const YES = new Set([
  'yes',
  'y',
  'yeah',
  'yea',
  'yep',
  'yup',
  'ok',
  'okay',
  'k',
  'sure',
  'confirm',
  'confirmed',
  'go',
  'go ahead',
  'do it',
  'yes please',
  'yes do it',
  'yes go ahead',
  'oya',
  'oya do am',
  'do am',
  'sharp',
  'na so',
  'correct',
  'bet',
  'ehen',
  'beeni',
  'ee',
]);
const NO = new Set([
  'no',
  'n',
  'nope',
  'nah',
  'cancel',
  'stop',
  'dont',
  'don t',
  'no thanks',
  'leave it',
  'leave am',
  'no o',
  'mba',
  'rara',
  'a a',
]);

/** Whether a short reply means "yes, do it" (only short replies count: no guessing). */
export function isConfirmation(text: string): boolean {
  return YES.has(normalise(text));
}

/** Whether a short reply means "no, don't". */
export function isRefusal(text: string): boolean {
  return NO.has(normalise(text));
}
