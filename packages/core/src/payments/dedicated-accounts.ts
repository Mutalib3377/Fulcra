import { formatNaira } from '@fulcra/config';
import { schema, withTenant } from '@fulcra/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordEvent, userActor } from '../events/events';
import {
  authorize,
  isAssistant,
  requireMember,
  type ActorContext,
  type Performer,
} from '../members/access';
import { CoreError } from '../shared/errors';
import { dedicatedAccountBank, getPaystackClient, PaystackError } from './paystack';
import { dedicatedAccountEmail } from './urls';

const EDITORS = ['owner', 'staff'] as const;

export type DedicatedAccountView = {
  accountNumber: string;
  accountName: string;
  bankName: string;
};

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? '';
  return { firstName, lastName: parts.slice(1).join(' ') || firstName };
}

/** The customer's dedicated account at this business, if they have one. */
export async function getCustomerDedicatedAccount(
  actor: ActorContext,
  customerId: string,
): Promise<DedicatedAccountView | null> {
  const id = z.uuid().parse(customerId);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const [account] = await tx
      .select()
      .from(schema.dedicatedAccounts)
      .where(
        and(
          eq(schema.dedicatedAccounts.customerId, id),
          eq(schema.dedicatedAccounts.status, 'active'),
        ),
      )
      .limit(1);
    return account?.accountNumber
      ? {
          accountNumber: account.accountNumber,
          accountName: account.accountName ?? '',
          bankName: account.bankName ?? '',
        }
      : null;
  });
}

/**
 * Gives a customer their own bank account number at this business (created once, then reused),
 * linked to the business's subaccount so transfers settle to the seller (docs/decisions/0002).
 * Owner or staff. On failure the payment link is the fallback.
 */
export async function getOrCreateDedicatedAccount(
  actor: Performer,
  customerId: string,
): Promise<DedicatedAccountView> {
  const id = z.uuid().parse(customerId);
  const ctx = await withTenant(actor.businessId, async (tx) => {
    await authorize(tx, actor, EDITORS);
    const [business] = await tx
      .select({ subaccount: schema.businesses.paystackSubaccountCode })
      .from(schema.businesses)
      .limit(1);
    if (!business?.subaccount) {
      throw new CoreError(
        'conflict',
        'Set up where you get paid first (Settings → Get paid).',
        'payout',
      );
    }
    const [customer] = await tx
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, id))
      .limit(1);
    if (!customer) throw new CoreError('not_found', 'This customer no longer exists.');
    const [existing] = await tx
      .select()
      .from(schema.dedicatedAccounts)
      .where(eq(schema.dedicatedAccounts.customerId, id))
      .for('update')
      .limit(1);
    if (existing?.status === 'active' && existing.accountNumber)
      return { kind: 'done', account: existing! } as const;
    if (!customer.name.trim() || !customer.phone) {
      throw new CoreError(
        'validation',
        'Add the customer’s full name and phone number first. Paystack needs them to create an account.',
        'customer',
      );
    }
    const [row] = existing
      ? [existing]
      : await tx
          .insert(schema.dedicatedAccounts)
          .values({ businessId: actor.businessId, customerId: id })
          .returning();
    return { kind: 'pending', row: row!, customer, subaccount: business.subaccount } as const;
  });

  const view = (a: schema.DedicatedAccount): DedicatedAccountView => ({
    accountNumber: a.accountNumber!,
    accountName: a.accountName ?? '',
    bankName: a.bankName ?? '',
  });
  if (ctx.kind === 'done') return view(ctx.account);
  const { row, customer, subaccount } = ctx;

  const paystack = getPaystackClient();
  let customerCode = row.providerCustomerCode;
  try {
    if (!customerCode) {
      ({ customerCode } = await paystack.createCustomer({
        email: dedicatedAccountEmail(customer.id),
        phone: customer.phone!,
        ...splitName(customer.name),
      }));
      await withTenant(actor.businessId, (tx) =>
        tx
          .update(schema.dedicatedAccounts)
          .set({ providerCustomerCode: customerCode })
          .where(eq(schema.dedicatedAccounts.id, row.id)),
      );
    }
    const account = await paystack.createDedicatedAccount({
      customerCode: customerCode!,
      preferredBank: dedicatedAccountBank(),
      subaccount,
    });
    const [saved] = await withTenant(actor.businessId, (tx) =>
      tx
        .update(schema.dedicatedAccounts)
        .set({ ...account, status: 'active', failureReason: null })
        .where(eq(schema.dedicatedAccounts.id, row.id))
        .returning(),
    );
    return view(saved!);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await withTenant(actor.businessId, (tx) =>
      tx
        .update(schema.dedicatedAccounts)
        .set({ status: 'failed', failureReason: reason.slice(0, 500) })
        .where(eq(schema.dedicatedAccounts.id, row.id)),
    );
    if (error instanceof PaystackError || error instanceof CoreError) {
      throw new CoreError(
        'conflict',
        `Paystack could not create an account for this customer (${reason}). Send a payment link instead; it also accepts bank transfers.`,
      );
    }
    throw error;
  }
}

/**
 * "Send account details" on an order: makes sure the customer has their own account, moves a new
 * order to awaiting payment, and returns a ready-to-send message.
 */
export async function prepareAccountDetails(
  actor: Performer,
  orderId: string,
): Promise<{ account: DedicatedAccountView; message: string }> {
  const id = z.uuid().parse(orderId);
  const order = await withTenant(actor.businessId, async (tx) => {
    await authorize(tx, actor, EDITORS);
    const [row] = await tx
      .select({
        order: schema.orders,
        businessName: schema.businesses.name,
        customerName: schema.customers.name,
      })
      .from(schema.orders)
      .innerJoin(schema.businesses, eq(schema.businesses.id, schema.orders.businessId))
      .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(eq(schema.orders.id, id))
      .limit(1);
    if (!row) throw new CoreError('not_found', 'This order no longer exists.');
    if (row.order.status !== 'new' && row.order.status !== 'awaiting_payment') {
      throw new CoreError('conflict', 'Account details are only for orders that are not paid yet.');
    }
    return row;
  });

  const account = await getOrCreateDedicatedAccount(actor, order.order.customerId);

  await withTenant(actor.businessId, async (tx) => {
    const [moved] = await tx
      .update(schema.orders)
      .set({ status: 'awaiting_payment' })
      .where(and(eq(schema.orders.id, id), eq(schema.orders.status, 'new')))
      .returning({ customerId: schema.orders.customerId });
    if (moved) {
      await recordEvent(tx, actor.businessId, {
        type: 'order.status_changed',
        actor: isAssistant(actor) ? { type: 'agent' } : userActor(actor),
        orderId: id,
        customerId: moved.customerId,
        payload: { orderNumber: order.order.orderNumber, from: 'new', to: 'awaiting_payment' },
      });
    }
  });

  const firstName = splitName(order.customerName).firstName || 'there';
  const message = [
    `Hello ${firstName}, to pay ${formatNaira(order.order.total)} for order #${order.order.orderNumber} from ${order.businessName}, please transfer to:`,
    ``,
    `Bank: ${account.bankName}`,
    `Account number: ${account.accountNumber}`,
    `Account name: ${account.accountName}`,
    ``,
    `This account is just for you, so your payment is confirmed automatically. Please send the exact amount.`,
  ].join('\n');
  return { account, message };
}
