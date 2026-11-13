import { schema, type Tx } from '@fulcra/db';
import { and, eq, ne } from 'drizzle-orm';
import { recordEvent, type EventActorRef } from '../events/events';

/**
 * Moves everything of one customer onto another (same business), e.g. an anonymous website
 * visitor who turns out to be a known WhatsApp customer: chats, channel identities, orders,
 * payments and events. The emptied customer is deleted, unless it still owns a dedicated
 * transfer account and the other customer has one too (then both are kept).
 */
export async function mergeCustomerIntoInTx(
  tx: Tx,
  businessId: string,
  fromId: string,
  intoId: string,
  actor: EventActorRef,
): Promise<void> {
  if (fromId === intoId) return;
  const conv = schema.conversations;
  // One open chat per customer per channel account: the moved chat (the live one) wins.
  const moving = await tx
    .select({ connectionId: conv.connectionId })
    .from(conv)
    .where(and(eq(conv.customerId, fromId), eq(conv.status, 'open')));
  for (const { connectionId } of moving) {
    await tx
      .update(conv)
      .set({ status: 'closed' })
      .where(
        and(
          eq(conv.customerId, intoId),
          eq(conv.connectionId, connectionId),
          eq(conv.status, 'open'),
        ),
      );
  }
  await tx.update(conv).set({ customerId: intoId }).where(eq(conv.customerId, fromId));
  await tx
    .update(schema.customerIdentities)
    .set({ customerId: intoId })
    .where(eq(schema.customerIdentities.customerId, fromId));
  await tx
    .update(schema.orders)
    .set({ customerId: intoId })
    .where(eq(schema.orders.customerId, fromId));
  await tx
    .update(schema.payments)
    .set({ customerId: intoId })
    .where(eq(schema.payments.customerId, fromId));
  await tx
    .update(schema.events)
    .set({ customerId: intoId })
    .where(eq(schema.events.customerId, fromId));

  const [targetAccount] = await tx
    .select({ id: schema.dedicatedAccounts.id })
    .from(schema.dedicatedAccounts)
    .where(eq(schema.dedicatedAccounts.customerId, intoId))
    .limit(1);
  if (!targetAccount) {
    await tx
      .update(schema.dedicatedAccounts)
      .set({ customerId: intoId })
      .where(eq(schema.dedicatedAccounts.customerId, fromId));
  }
  const [leftAccount] = await tx
    .select({ id: schema.dedicatedAccounts.id })
    .from(schema.dedicatedAccounts)
    .where(eq(schema.dedicatedAccounts.customerId, fromId))
    .limit(1);
  if (!leftAccount) {
    await tx
      .delete(schema.customers)
      .where(and(eq(schema.customers.id, fromId), ne(schema.customers.id, intoId)));
  }
  await recordEvent(tx, businessId, {
    type: 'customer.linked',
    actor,
    customerId: intoId,
    payload: { mergedCustomerId: fromId },
  });
}
