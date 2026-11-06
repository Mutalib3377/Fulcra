import { schema, withTenant, type Tx } from '@fulcra/db';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordEvent, userActor, type EventActorRef } from '../events/events';
import { requireMember, type ActorContext } from '../members/access';
import { CoreError, isForeignKeyViolation, isUniqueViolation } from '../shared/errors';
import { normalizePhoneNumber } from '../shared/phone';

const EDITORS = ['owner', 'staff'] as const;

const phoneField = z
  .string()
  .trim()
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const phone = normalizePhoneNumber(value);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, e.g. 0803 123 4567.' });
      return z.NEVER;
    }
    return phone;
  });

const identityInput = z.object({
  channel: z.enum(schema.channels),
  externalUserId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().max(120).default(''),
});

export const findOrCreateCustomerInput = z
  .object({
    name: z.string().trim().max(120).default(''),
    phone: phoneField,
    identity: identityInput.optional(),
  })
  .refine((v) => v.phone || v.identity || v.name, {
    message: 'Enter the customer’s name or phone number.',
    path: ['name'],
  });
export type FindOrCreateCustomerInput = z.input<typeof findOrCreateCustomerInput>;

/**
 * Finds a customer by channel identity or phone number, or creates one, inside an existing
 * tenant transaction. A found customer gets the identity linked and a missing name filled in.
 * Without a phone or identity (e.g. a walk-in with only a name), a new customer is created.
 */
export async function findOrCreateCustomerInTx(
  tx: Tx,
  businessId: string,
  input: FindOrCreateCustomerInput,
  actor: EventActorRef,
): Promise<{ customer: schema.Customer; created: boolean }> {
  const data = findOrCreateCustomerInput.parse(input);
  const c = schema.customers;

  let customer: schema.Customer | undefined;
  if (data.identity) {
    const [row] = await tx
      .select({ customer: c })
      .from(schema.customerIdentities)
      .innerJoin(c, eq(c.id, schema.customerIdentities.customerId))
      .where(
        and(
          eq(schema.customerIdentities.channel, data.identity.channel),
          eq(schema.customerIdentities.externalUserId, data.identity.externalUserId),
        ),
      )
      .limit(1);
    customer = row?.customer;
  }
  if (!customer && data.phone) {
    [customer] = await tx.select().from(c).where(eq(c.phone, data.phone)).limit(1);
  }

  let created = false;
  if (!customer) {
    // A savepoint lets us recover if the same phone is created at the same moment.
    try {
      customer = await tx.transaction(async (sp) => {
        const [row] = await sp
          .insert(c)
          .values({
            businessId,
            name: data.name || data.identity?.displayName || '',
            phone: data.phone,
          })
          .returning();
        return row!;
      });
      created = true;
    } catch (error) {
      if (!data.phone || !isUniqueViolation(error, 'customers_phone_unique')) throw error;
      [customer] = await tx.select().from(c).where(eq(c.phone, data.phone)).limit(1);
      if (!customer) throw error;
    }
  } else if (!customer.name && (data.name || data.identity?.displayName)) {
    [customer] = await tx
      .update(c)
      .set({ name: data.name || data.identity?.displayName })
      .where(eq(c.id, customer.id))
      .returning();
  }

  if (data.identity) {
    await tx
      .insert(schema.customerIdentities)
      .values({ businessId, customerId: customer!.id, ...data.identity })
      .onConflictDoNothing();
  }
  if (created) {
    await recordEvent(tx, businessId, {
      type: 'customer.created',
      actor,
      customerId: customer!.id,
      payload: { name: customer!.name, phone: customer!.phone },
    });
  }
  return { customer: customer!, created };
}

/** Finds or creates a customer (see `findOrCreateCustomerInTx`). Owner or staff. */
export async function findOrCreateCustomer(
  actor: ActorContext,
  input: FindOrCreateCustomerInput,
): Promise<{ customer: schema.Customer; created: boolean }> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    return findOrCreateCustomerInTx(tx, actor.businessId, input, userActor(actor));
  });
}

const tagList = z
  .array(z.string().trim().min(1).max(30))
  .max(20)
  .transform((tags) => [...new Map(tags.map((t) => [t.toLowerCase(), t])).values()]);

export const updateCustomerInput = z.object({
  name: z.string().trim().min(1, 'Enter the customer’s name.').max(120),
  phone: phoneField,
  email: z
    .email('Enter a valid email address.')
    .trim()
    .toLowerCase()
    .nullish()
    .or(z.literal('').transform(() => null)),
  address: z.string().trim().max(300).default(''),
  deliveryZoneId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  tags: tagList.default([]),
  notes: z.string().trim().max(2000).default(''),
  marketingOptIn: z.boolean().default(false),
});
export type UpdateCustomerInput = z.input<typeof updateCustomerInput>;

export async function updateCustomer(
  actor: ActorContext,
  customerId: string,
  input: UpdateCustomerInput,
): Promise<schema.Customer> {
  const id = z.uuid().parse(customerId);
  const data = updateCustomerInput.parse(input);
  try {
    return await withTenant(actor.businessId, async (tx) => {
      await requireMember(tx, actor, EDITORS);
      const [customer] = await tx
        .update(schema.customers)
        .set({ ...data, email: data.email ?? null })
        .where(eq(schema.customers.id, id))
        .returning();
      if (!customer) throw new CoreError('not_found', 'This customer no longer exists.');
      return customer;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'customers_phone_unique')) {
      throw new CoreError('conflict', 'Another customer already has this phone number.', 'phone');
    }
    if (isForeignKeyViolation(error)) {
      throw new CoreError('validation', 'Choose a delivery area from your list.', 'deliveryZoneId');
    }
    throw error;
  }
}

export type CustomerSummary = {
  id: string;
  name: string;
  phone: string | null;
  address: string;
  deliveryZoneId: string | null;
  tags: string[];
  orderCount: number;
  /** Total of paid, dispatched and delivered orders, in kobo. */
  totalSpent: number;
  lastOrderAt: Date | null;
  /** "new" (0–1 orders) or "repeat" (2+), worked out from order history. */
  kind: 'new' | 'repeat';
};

const PAID_STATUSES = ['paid', 'dispatched', 'delivered'] as const;

/** Customers, most recent first. Searches name and phone. */
export async function listCustomers(
  actor: ActorContext,
  filter: { search?: string } = {},
): Promise<CustomerSummary[]> {
  const search = z.string().trim().max(100).optional().parse(filter.search);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const c = schema.customers;
    const o = schema.orders;
    const conditions = [];
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      const digits = search.replace(/\D/g, '');
      conditions.push(
        or(
          ilike(c.name, like),
          digits.length >= 4 ? ilike(c.phone, `%${digits.replace(/^0/, '')}%`) : undefined,
        ),
      );
    }
    const rows = await tx
      .select({
        id: c.id,
        name: c.name,
        phone: c.phone,
        address: c.address,
        deliveryZoneId: c.deliveryZoneId,
        tags: c.tags,
        createdAt: c.createdAt,
        orderCount: sql<number>`count(${o.id}) filter (where ${o.status} <> 'cancelled')::int`,
        totalSpent: sql<number>`coalesce(sum(${o.total}) filter (where ${inArray(o.status, [...PAID_STATUSES])}), 0)::int`,
        lastOrderAt: sql<Date | null>`max(${o.createdAt})`,
      })
      .from(c)
      .leftJoin(o, eq(o.customerId, c.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(c.id)
      .orderBy(desc(sql`coalesce(max(${o.createdAt}), ${c.createdAt})`))
      .limit(500);
    return rows.map(({ createdAt: _created, lastOrderAt, ...r }) => ({
      ...r,
      lastOrderAt: lastOrderAt ? new Date(lastOrderAt) : null,
      kind: r.orderCount >= 2 ? 'repeat' : 'new',
    }));
  });
}

export type CustomerDetail = {
  customer: schema.Customer;
  identities: schema.CustomerIdentity[];
  orders: Pick<schema.Order, 'id' | 'orderNumber' | 'status' | 'total' | 'createdAt'>[];
  totalSpent: number;
  kind: 'new' | 'repeat';
};

export async function getCustomer(
  actor: ActorContext,
  customerId: string,
): Promise<CustomerDetail> {
  const id = z.uuid().parse(customerId);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const [customer] = await tx
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, id))
      .limit(1);
    if (!customer) throw new CoreError('not_found', 'This customer no longer exists.');
    const identities = await tx
      .select()
      .from(schema.customerIdentities)
      .where(eq(schema.customerIdentities.customerId, id));
    const o = schema.orders;
    const orders = await tx
      .select({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total,
        createdAt: o.createdAt,
      })
      .from(o)
      .where(eq(o.customerId, id))
      .orderBy(desc(o.createdAt));
    const counted = orders.filter((x) => x.status !== 'cancelled');
    return {
      customer,
      identities,
      orders,
      totalSpent: orders
        .filter((x) => (PAID_STATUSES as readonly string[]).includes(x.status))
        .reduce((sum, x) => sum + x.total, 0),
      kind: counted.length >= 2 ? 'repeat' : 'new',
    };
  });
}
