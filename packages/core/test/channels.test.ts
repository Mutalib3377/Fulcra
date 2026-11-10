import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../src/jobs/queue';

const sent: string[] = [];
vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueSendMessage: async (_b: string, id: string) => {
    sent.push(id);
  },
  enqueueSubmitTemplates: async () => {},
}));

const { schema, withSystem, withTenant } = await import('@fulcra/db');
const { eq } = await import('drizzle-orm');
const ch = await import('../src/conversations/channels');
const { receiveInboundMessage, sendHumanReply, claimOutboundMessage, markMessageSent } =
  await import('../src/conversations/conversations');
const { listEvents } = await import('../src/events/events');
const { recordWhatsAppUsage, whatsAppMessageCostUsd } = await import('../src/usage/usage');
const { addMember, newBusiness } = await import('./helpers');

beforeEach(() => {
  sent.length = 0;
});

const phoneId = () => String(100_000_000_000 + Math.floor(Math.random() * 1e11));
const token = 'EAAG' + 'x'.repeat(40);

async function connected(label = 'wa') {
  const shop = await newBusiness(label);
  const phoneNumberId = phoneId();
  const connection = await ch.saveWhatsAppConnection(shop.actor, {
    phoneNumberId,
    businessAccountId: '987654321012345',
    accessToken: token,
    displayName: '+234 803 123 4567',
  });
  return { ...shop, connection, phoneNumberId };
}

describe('channel webhooks', () => {
  it('are saved once (same body = same event), and read back by the worker until processed', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: randomUUID() }],
    });
    const first = await ch.recordChannelWebhook('whatsapp', body);
    expect(first.status).toBe('saved');
    const again = await ch.recordChannelWebhook('whatsapp', body);
    expect(again).toMatchObject({ status: 'duplicate', processed: false });
    expect(await ch.recordChannelWebhook('whatsapp', 'not json')).toEqual({
      status: 'bad_payload',
    });

    const id = (first as { webhookEventId: string }).webhookEventId;
    const claimed = await ch.claimChannelWebhook(id);
    expect(claimed).toMatchObject({
      channel: 'whatsapp',
      payload: { object: 'whatsapp_business_account' },
    });
    await ch.markChannelWebhookProcessed(id, 'temporary problem');
    expect(await ch.claimChannelWebhook(id)).not.toBeNull(); // an error keeps it to retry
    await ch.markChannelWebhookProcessed(id);
    expect(await ch.claimChannelWebhook(id)).toBeNull();
    expect(await ch.recordChannelWebhook('whatsapp', body)).toMatchObject({
      status: 'duplicate',
      processed: true,
    });
  });
});

describe('connecting WhatsApp', () => {
  it('owner only; token encrypted; one business per number; the account leads to the business', async () => {
    const shop = await connected();
    expect(shop.connection).toMatchObject({ channel: 'whatsapp', status: 'connected' });

    const [row] = await withTenant(shop.business.id, (tx) =>
      tx
        .select()
        .from(schema.channelConnections)
        .where(eq(schema.channelConnections.id, shop.connection.id)),
    );
    expect(row!.credentials).not.toContain(token);
    expect(row!.externalBusinessId).toBe('987654321012345');

    const found = await ch.findConnectionByAccount('whatsapp', shop.phoneNumberId);
    expect(found).toMatchObject({ businessId: shop.business.id, mode: 'live' });
    expect(JSON.parse(found!.credentials!)).toEqual({ accessToken: token });
    expect(await ch.findConnectionByAccount('whatsapp', '123')).toBeNull();

    const staff = await addMember(shop.actor, 'staff');
    await expect(
      ch.saveWhatsAppConnection(staff, {
        phoneNumberId: phoneId(),
        businessAccountId: '1234567',
        accessToken: token,
      }),
    ).rejects.toThrow();
    expect(await ch.listChannelConnections(staff)).toHaveLength(1);

    const other = await newBusiness('wa-other');
    await expect(
      ch.saveWhatsAppConnection(other.actor, {
        phoneNumberId: shop.phoneNumberId,
        businessAccountId: '1234567',
        accessToken: token,
      }),
    ).rejects.toThrow('already connected to another Fulcra business');
    expect(await ch.listChannelConnections(other.actor)).toEqual([]);

    // Connecting again replaces the business's number (still one connection).
    const newId = phoneId();
    await ch.saveWhatsAppConnection(shop.actor, {
      phoneNumberId: newId,
      businessAccountId: '987654321012345',
      accessToken: token,
    });
    const list = await ch.listChannelConnections(shop.actor);
    expect(list.map((c) => c.externalAccountId)).toEqual([newId]);
    expect(
      (await listEvents(shop.actor)).filter((e) => e.type === 'channel.connected').length,
    ).toBeGreaterThanOrEqual(2);

    await ch.disconnectChannel(shop.actor, list[0]!.id);
    expect(await ch.listChannelConnections(shop.actor)).toEqual([]);
    expect(await ch.findConnectionByAccount('whatsapp', newId)).toBeNull();
    const [after] = await withSystem((tx) =>
      tx
        .select()
        .from(schema.channelConnections)
        .where(eq(schema.channelConnections.id, list[0]!.id)),
    );
    expect(after!.credentials).toBeNull();
  });
});

describe('delivery updates and costs', () => {
  async function sentMessage() {
    const shop = await connected('status');
    const r = (await receiveInboundMessage(shop.business.id, shop.connection.id, {
      externalId: `wamid.in-${randomUUID()}`,
      from: { externalUserId: '2348031234567', displayName: 'Chioma' },
      sentAt: new Date().toISOString(),
      type: 'text',
      text: 'Hello',
    })) as { conversationId: string; messageId: string };
    const reply = await sendHumanReply(shop.actor, r.conversationId, { text: 'Hi Chioma!' });
    const delivery = await claimOutboundMessage(shop.business.id, reply.id);
    expect(delivery).toMatchObject({ channel: 'whatsapp', mode: 'live', to: '2348031234567' });
    expect(JSON.parse(delivery!.credentials!)).toEqual({ accessToken: token });
    const wamid = `wamid.out-${randomUUID()}`;
    await markMessageSent(shop.business.id, reply.id, wamid);
    return { ...shop, inboundId: r.messageId, replyId: reply.id, wamid };
  }
  const statusOf = async (businessId: string, id: string) =>
    (
      await withTenant(businessId, (tx) =>
        tx.select().from(schema.messages).where(eq(schema.messages.id, id)),
      )
    )[0]!;

  it('ticks only move forward; failures keep a reason; unknown ids wait for a retry', async () => {
    const s = await sentMessage();
    const b = s.business.id;
    expect(await ch.applyMessageStatus(b, { externalId: s.wamid, status: 'delivered' })).toBe(
      'updated',
    );
    expect(await ch.applyMessageStatus(b, { externalId: s.wamid, status: 'sent' })).toBe(
      'unchanged',
    );
    expect(await ch.applyMessageStatus(b, { externalId: s.wamid, status: 'read' })).toBe('updated');
    expect((await statusOf(b, s.replyId)).status).toBe('read');
    expect(
      await ch.applyMessageStatus(b, { externalId: s.wamid, status: 'failed', error: 'x' }),
    ).toBe('unchanged');
    expect(await ch.applyMessageStatus(b, { externalId: 'wamid.unknown', status: 'read' })).toBe(
      'not_found',
    );

    // Another business can never touch this message.
    const other = await newBusiness('status-other');
    expect(
      await ch.applyMessageStatus(other.business.id, { externalId: s.wamid, status: 'failed' }),
    ).toBe('not_found');
  });

  it('a failed message shows the reason', async () => {
    const s = await sentMessage();
    await ch.applyMessageStatus(s.business.id, {
      externalId: s.wamid,
      status: 'failed',
      error: "This number can't receive WhatsApp messages.",
    });
    expect(await statusOf(s.business.id, s.replyId)).toMatchObject({
      status: 'failed',
      error: "This number can't receive WhatsApp messages.",
    });
  });

  it('each charged WhatsApp message is costed once against the business', async () => {
    const s = await sentMessage();
    expect(
      await recordWhatsAppUsage(s.business.id, { reference: s.wamid, category: 'service' }),
    ).toBe(true);
    expect(
      await recordWhatsAppUsage(s.business.id, { reference: s.wamid, category: 'service' }),
    ).toBe(false);
    const rows = await withTenant(s.business.id, (tx) => tx.select().from(schema.usageRecords));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'whatsapp_message',
      feature: 'whatsapp.service',
      reference: s.wamid,
      costUsd: 0.0101,
    });
    expect(whatsAppMessageCostUsd('marketing')).toBe(0.062);
    expect(whatsAppMessageCostUsd('something_new')).toBe(0.062); // never under-count
  });

  it('read receipts: the customer message and live connection (never for test chats)', async () => {
    const s = await sentMessage();
    const target = await ch.readReceiptTarget(s.business.id, s.inboundId);
    expect(target).toMatchObject({
      channel: 'whatsapp',
      externalAccountId: s.phoneNumberId,
      externalMessageId: expect.stringMatching(/^wamid\.in-/),
    });
    expect(await ch.readReceiptTarget(s.business.id, s.replyId)).toBeNull(); // not inbound

    await ch.markConnectionError(s.business.id, s.connection.id, 'The access token expired.');
    expect(await ch.readReceiptTarget(s.business.id, s.inboundId)).toBeNull();
    const [view] = await ch.listChannelConnections(s.actor);
    expect(view).toMatchObject({ status: 'error', lastError: 'The access token expired.' });
  });
});
