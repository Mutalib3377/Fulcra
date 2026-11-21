import type { EffectiveStatus } from '@fulcra/core/rules';

export const STATUS_LABEL: Record<EffectiveStatus, string> = {
  trialing: 'Free trial',
  active: 'Paying',
  past_due: 'Payment late',
  cancelled: 'Cancelled (paid up)',
  expired: 'Ended',
};

export const STATUS_TONE = {
  trialing: 'info',
  active: 'success',
  past_due: 'warning',
  cancelled: 'neutral',
  expired: 'danger',
} as const satisfies Record<EffectiveStatus, string>;
