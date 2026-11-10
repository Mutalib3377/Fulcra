import { schema, withTenant } from '@fulcra/db';
import { z } from 'zod';
import { requireMember, type ActorContext } from '../members/access';
import { normalizePhoneNumber } from '../shared/phone';

/** What the owner hears about on WhatsApp, and the switch for automatic customer messages. */
export const ownerAlertSettingsInput = z.object({
  /** The owner's own WhatsApp number (not the business number connected to Fulcra). */
  ownerWhatsapp: z
    .string()
    .trim()
    .max(30)
    .default('')
    .transform((value, ctx) => {
      if (!value) return null;
      const phone = normalizePhoneNumber(value);
      if (!phone) {
        ctx.addIssue({ code: 'custom', message: 'Enter a phone number like 0803 123 4567.' });
        return z.NEVER;
      }
      return phone;
    }),
  alertPaidOrders: z.boolean().default(true),
  alertLowStock: z.boolean().default(true),
  alertUnmatchedPayments: z.boolean().default(true),
  alertWaitingCustomers: z.boolean().default(true),
  briefingEnabled: z.boolean().default(true),
  briefingTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 08:00.')
    .default('08:00'),
  customerMessagesEnabled: z.boolean().default(true),
});
export type OwnerAlertSettingsInput = z.input<typeof ownerAlertSettingsInput>;
export type OwnerAlertSettingsView = z.output<typeof ownerAlertSettingsInput>;

export const OWNER_ALERT_DEFAULTS: OwnerAlertSettingsView = {
  ownerWhatsapp: null,
  alertPaidOrders: true,
  alertLowStock: true,
  alertUnmatchedPayments: true,
  alertWaitingCustomers: true,
  briefingEnabled: true,
  briefingTime: '08:00',
  customerMessagesEnabled: true,
};

export function toAlertSettingsView(
  row: schema.OwnerNotificationSettings | undefined,
): OwnerAlertSettingsView {
  if (!row) return OWNER_ALERT_DEFAULTS;
  return {
    ownerWhatsapp: row.ownerWhatsapp,
    alertPaidOrders: row.alertPaidOrders,
    alertLowStock: row.alertLowStock,
    alertUnmatchedPayments: row.alertUnmatchedPayments,
    alertWaitingCustomers: row.alertWaitingCustomers,
    briefingEnabled: row.briefingEnabled,
    briefingTime: row.briefingTime,
    customerMessagesEnabled: row.customerMessagesEnabled,
  };
}

/** Alert settings (defaults until saved). Owner or staff can read. */
export async function getOwnerAlertSettings(actor: ActorContext): Promise<OwnerAlertSettingsView> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner', 'staff']);
    const [row] = await tx.select().from(schema.ownerNotificationSettings).limit(1);
    return toAlertSettingsView(row);
  });
}

/** Saves alert settings. Owner only (it is their phone that gets the messages). */
export async function saveOwnerAlertSettings(
  actor: ActorContext,
  input: OwnerAlertSettingsInput,
): Promise<OwnerAlertSettingsView> {
  const data = ownerAlertSettingsInput.parse(input);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    const [row] = await tx
      .insert(schema.ownerNotificationSettings)
      .values({ businessId: actor.businessId, ...data })
      .onConflictDoUpdate({ target: schema.ownerNotificationSettings.businessId, set: data })
      .returning();
    return toAlertSettingsView(row);
  });
}
