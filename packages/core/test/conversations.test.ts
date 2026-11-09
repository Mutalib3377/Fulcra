import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundMessageInput } from '../src/conversations/message-types';
import type * as QueueModule from '../src/jobs/queue';

const sent: string[] = [];
const inbound: { businessId: string; connectionId: string; message: Record<string, unknown> }[] =
  [];
vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueSendMessage: async (_b: string, messageId: string) => {
    sent.push(messageId);
  },
  enqueueInboundMessage: async (
    businessId: string,
    connectionId: string,
    message: Record<string, unknown>,
  ) => {
    inbound.push({ businessId, connectionId, message });
  },
}));

const { schema, withTenant } = await import('@fulcra/db');
const { eq } = await import('drizzle-orm');
const { encryptSecret } = await import('../src/shared/crypto');
const { listEvents } = await import('../src/events/events');
const {
  claimOutboundMessage,
  countConversationsNeedingAttention,
  getConversation,
  getTestChat,
  listConversations,
  markMessageSent,
  receiveInboundMessage,
  sendHumanReply,
  sendTestCustomerMessage,
  setConversationHandler,
} = await import('../src/conversations/conversations');
const { addMember, newBusiness } = await import('./helpers');

beforeEach(() => {
  sent.length = 0;
  inbound.length = 0;
});

async function liveWhatsApp(businessId: string) {
  return withTenant(businessId, async (tx) => {
    const [row] = await tx
      .insert(schema.channelConnections)
      .values({
        businessId,
        channel: 'whatsapp',
        externalAccountId: `pn-${randomUUID()}`,
        displayName: '+234 803 000 0000',
        credentials: encryptSecret('{"token":"EAAG-secret"}'),
      })
      .returning();
    return row!;
  });
}

const msg = (extra: Partial<InboundMessageInput> = {}): InboundMessageInput => ({
  externalId: `wamid.${randomUUID()}`,
  from: { externalUserId: '2348031234567', displayName: 'Chioma' },
  sentAt: new Date().toISOString(),
  type: 'text' as const,
  text: 'How much is the Ankara dress?',
  ...extra,
});

describe('incoming messages', () => {
  it('creates the customer and chat, saves once, and waits for the team while the assistant is off', async () => {
    const { actor, business } = await newBusiness('chat');
    const connection = await liveWhatsApp(business.id);
    const first = msg();
    const result = await receiveInboundMessage(business.id, connection.id, first);
    expect(result).toMatchObject({ status: 'saved', route: 'human' });
    expect(await receiveInboundMessage(business.id, connection.id, first)).toEqual({
      status: 'duplicate',
    });
    await receiveInboundMessage(
      business.id,
      connection.id,
      msg({ type: 'image', text: '', media: { providerMediaId: 'm1', mimeType: 'image/jpeg' } }),
    );

    const [item] = await listConversations(actor, 'attention');
    expect(item).toMatchObject({
      customerName: 'Chioma',
      customerPhone: '+2348031234567',
      channel: 'whatsapp',
      isTest: false,
      handledBy: 'agent',
      needsAttention: true,
      attentionReason: 'Your assistant is off',
      lastMessagePreview: '📷 Photo',
      unreadCount: 2,
    });
    expect(await countConversationsNeedingAttention(actor)).toBe(1);

    const view = await getConversation(actor, item!.id);
    expect(view.messages.map((x) => [x.direction, x.sender, x.type, x.text])).toEqual([
      ['inbound', 'customer', 'text', 'How much is the Ankara dress?'],
      ['inbound', 'customer', 'image', ''],
    ]);
    expect(view.window.open).toBe(true);
    expect((await listConversations(actor))[0]!.unreadCount).toBe(0); // opening marks read
    // Both are written in the same transaction (same timestamp): check both exist, not their order.
    expect((await listEvents(actor)).map((e) => e.type)).toEqual(
      expect.arrayContaining(['conversation.started', 'customer.created']),
    );
  });

  it('routes to the assistant when it is on and handling the chat', async () => {
    const { business } = await newBusiness('chat');
    const connection = await liveWhatsApp(business.id);
    await withTenant(business.id, (tx) =>
      tx.insert(schema.agentSettings).values({ businessId: business.id, enabled: true }),
    );
    expect(await receiveInboundMessage(business.id, connection.id, msg())).toMatchObject({
      route: 'agent',
    });
  });

  it("ignores another business's connection", async () => {
    const one = await newBusiness('chat');
    const two = await newBusiness('chat');
    const connection = await liveWhatsApp(one.business.id);
    expect(await receiveInboundMessage(two.business.id, connection.id, msg())).toMatchObject({
      status: 'ignored',
    });
  });
});

describe('replies and handover', () => {
  it('a reply takes over the chat, is queued, and the worker gets what it needs to send it', async () => {
    const { actor, business } = await newBusiness('chat');
    const connection = await liveWhatsApp(business.id);
    const { conversationId } = (await receiveInboundMessage(business.id, connection.id, msg())) as {
      conversationId: string;
    };

    const reply = await sendHumanReply(actor, conversationId, {
      text: 'It is ₦25,000. Which size?',
    });
    expect(reply).toMatchObject({
      direction: 'outbound',
      sender: 'human',
      status: 'queued',
      sentByUserId: actor.userId,
    });
    expect(sent).toEqual([reply.id]);
    const view = await getConversation(actor, conversationId);
    expect(view.conversation).toMatchObject({
      handledBy: 'human',
      needsAttention: false,
      lastMessagePreview: 'It is ₦25,000. Which size?',
    });
    expect((await listEvents(actor))[0]).toMatchObject({
      type: 'conversation.handoff',
      payload: expect.objectContaining({ to: 'human', reason: 'replied' }),
    });

    const delivery = await claimOutboundMessage(business.id, reply.id);
    expect(delivery).toMatchObject({
      channel: 'whatsapp',
      mode: 'live',
      to: '2348031234567',
      credentials: '{"token":"EAAG-secret"}',
    });
    await markMessageSent(business.id, reply.id, 'wamid.out1');
    expect(await claimOutboundMessage(business.id, reply.id)).toBeNull();

    // While a person handles the chat, new messages wait for them.
    await receiveInboundMessage(business.id, connection.id, msg({ text: 'Size M please' }));
    expect((await getConversation(actor, conversationId)).conversation).toMatchObject({
      needsAttention: true,
      attentionReason: 'Waiting for your reply',
    });

    await setConversationHandler(actor, conversationId, 'agent');
    expect((await getConversation(actor, conversationId)).conversation).toMatchObject({
      handledBy: 'agent',
      needsAttention: false,
    });
    await setConversationHandler(actor, conversationId, 'human');
    expect((await listConversations(actor, 'human')).map((x) => x.id)).toEqual([conversationId]);
  });

  it('blocks free-form replies 24 hours after the customer last wrote', async () => {
    const { actor, business } = await newBusiness('chat');
    const connection = await liveWhatsApp(business.id);
    const old = new Date(Date.now() - 25 * 3_600_000).toISOString();
    const { conversationId } = (await receiveInboundMessage(
      business.id,
      connection.id,
      msg({ sentAt: old }),
    )) as { conversationId: string };
    expect((await getConversation(actor, conversationId)).window.open).toBe(false);
    await expect(sendHumanReply(actor, conversationId, { text: 'Hello?' })).rejects.toThrow(
      'more than 24 hours',
    );
  });

  it('only owners and staff use the inbox; businesses never see each other’s chats', async () => {
    const one = await newBusiness('chat');
    const two = await newBusiness('chat');
    const connection = await liveWhatsApp(one.business.id);
    const { conversationId } = (await receiveInboundMessage(
      one.business.id,
      connection.id,
      msg(),
    )) as { conversationId: string };
    const rider = await addMember(one.actor, 'rider');
    await expect(listConversations(rider)).rejects.toThrow();
    await expect(getConversation(two.actor, conversationId)).rejects.toThrow('no longer exists');
    expect(await listConversations(two.actor)).toEqual([]);
  });
});

describe('test chat', () => {
  it('goes through the same pipeline and shows in the inbox as a test', async () => {
    const { actor, business } = await newBusiness('chat');
    await sendTestCustomerMessage(actor, { text: 'Do you deliver to Lekki?' });
    expect(inbound).toHaveLength(1);
    // The worker stores it.
    const job = inbound[0]!;
    expect(job.businessId).toBe(business.id);
    await receiveInboundMessage(job.businessId, job.connectionId, job.message as never);

    const chat = await getTestChat(actor);
    expect(chat.messages.map((x) => x.text)).toEqual(['Do you deliver to Lekki?']);
    const [item] = await listConversations(actor);
    expect(item).toMatchObject({
      isTest: true,
      customerName: 'Test customer',
      customerPhone: null,
    });

    await sendHumanReply(actor, chat.conversationId!, { text: 'Yes, ₦2,000.' });
    expect((await getTestChat(actor)).messages.map((x) => x.sender)).toEqual(['customer', 'human']);
    const conn = await withTenant(business.id, (tx) =>
      tx.select().from(schema.channelConnections).where(eq(schema.channelConnections.mode, 'test')),
    );
    expect(conn).toHaveLength(1);
    await sendTestCustomerMessage(actor, { text: 'Thanks' });
    expect(inbound[1]!.connectionId).toBe(conn[0]!.id); // same test connection
  });

  it("sends a photo: only the business's own stored image, kept on the message", async () => {
    const { actor, business } = await newBusiness('photo');
    const other = await newBusiness('photo-other');
    const image = { path: `${business.id}/${randomUUID()}`, width: 600, height: 800 };
    await expect(sendTestCustomerMessage(actor, { text: '' })).rejects.toThrow(
      'Type a message or add a photo.',
    );
    await expect(
      sendTestCustomerMessage(actor, {
        image: { ...image, path: `${other.business.id}/${randomUUID()}` },
      }),
    ).rejects.toThrow('could not be used');

    inbound.length = 0;
    await sendTestCustomerMessage(actor, { text: 'This one?', image });
    const job = inbound[0]!;
    expect(job.message).toMatchObject({ type: 'image', media: { image, caption: 'This one?' } });
    await receiveInboundMessage(job.businessId, job.connectionId, job.message as never);
    const [message] = (await getTestChat(actor)).messages;
    expect(message).toMatchObject({ type: 'image', text: 'This one?', media: { image } });
    const [item] = await listConversations(actor);
    expect(item!.lastMessagePreview).toContain('This one?');

    // A channel can never attach another business's file.
    const foreign = { path: `${other.business.id}/${randomUUID()}`, width: 1, height: 1 };
    await receiveInboundMessage(job.businessId, job.connectionId, {
      ...(job.message as InboundMessageInput),
      externalId: `test-${randomUUID()}`,
      media: { image: foreign },
    });
    const saved = (await getTestChat(actor)).messages.at(-1)!;
    expect(saved.media?.image).toBeUndefined();
  });
});
