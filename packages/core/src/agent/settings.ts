import { schema, withTenant } from '@fulcra/db';
import { z } from 'zod';
import { requireMember, type ActorContext } from '../members/access';
import { PAYMENT_OPTIONS, WEEKDAYS } from './rules';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00.');
const slot = z
  .tuple([time, time])
  .refine(([from, to]) => from < to, 'The closing time must be after the opening time.');

export const agentSettingsInput = z.object({
  enabled: z.boolean(),
  greeting: z.string().trim().max(300, 'Keep the greeting under 300 characters.').default(''),
  awayMessage: z
    .string()
    .trim()
    .max(500, 'Keep the away message under 500 characters.')
    .default(''),
  /** Null: always open. */
  businessHours: z
    .object(
      Object.fromEntries(WEEKDAYS.map((d) => [d, z.array(slot).max(3).optional()])) as Record<
        (typeof WEEKDAYS)[number],
        z.ZodOptional<z.ZodArray<typeof slot>>
      >,
    )
    .nullable()
    .default(null),
  afterHoursOrders: z.boolean().default(true),
  policies: z.string().trim().max(3000, 'Keep your policies under 3,000 characters.').default(''),
  handoffTopics: z
    .array(z.string().trim().min(1).max(60, 'Keep each topic short.'))
    .max(20, 'Add up to 20 topics.')
    .default([])
    .transform((topics) => [...new Map(topics.map((t) => [t.toLowerCase(), t])).values()]),
  /** How the assistant offers payment: a Paystack link, the customer's transfer account, or both. */
  paymentOptions: z
    .array(z.enum(PAYMENT_OPTIONS))
    .min(1, 'Choose at least one way for customers to pay.')
    .default(['link', 'transfer'])
    .transform((options) => PAYMENT_OPTIONS.filter((o) => options.includes(o))),
});

export type AgentSettingsInput = z.input<typeof agentSettingsInput>;
export type AgentSettingsView = z.output<typeof agentSettingsInput>;

export const AGENT_SETTINGS_DEFAULTS: AgentSettingsView = {
  enabled: false,
  greeting: '',
  awayMessage: '',
  businessHours: null,
  afterHoursOrders: true,
  policies: '',
  handoffTopics: [],
  paymentOptions: ['link', 'transfer'],
};

const toView = (row: schema.AgentSettings | undefined): AgentSettingsView =>
  row
    ? {
        enabled: row.enabled,
        greeting: row.greeting,
        awayMessage: row.awayMessage,
        businessHours: row.businessHours ?? null,
        afterHoursOrders: row.afterHoursOrders,
        policies: row.policies,
        handoffTopics: row.handoffTopics,
        paymentOptions: PAYMENT_OPTIONS.filter((o) => row.paymentOptions.includes(o)),
      }
    : AGENT_SETTINGS_DEFAULTS;

/** The assistant's settings (defaults until saved). Owner or staff can read. */
export async function getAgentSettings(actor: ActorContext): Promise<AgentSettingsView> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner', 'staff']);
    const [row] = await tx.select().from(schema.agentSettings).limit(1);
    return toView(row);
  });
}

/** Saves the assistant's settings (switching it on or off included). Owner only. */
export async function saveAgentSettings(
  actor: ActorContext,
  input: AgentSettingsInput,
): Promise<AgentSettingsView> {
  const data = agentSettingsInput.parse(input);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    const values = { ...data, businessHours: data.businessHours ?? null };
    const [row] = await tx
      .insert(schema.agentSettings)
      .values({ businessId: actor.businessId, ...values })
      .onConflictDoUpdate({ target: schema.agentSettings.businessId, set: values })
      .returning();
    return toView(row);
  });
}
