import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../src/jobs/queue';

const agentJobs: { businessId: string; chatId: string; messageId: string }[] = [];
const sends: { businessId: string; messageId: string }[] = [];
vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueOwnerMessage: async (businessId: string, chatId: string, messageId: string) => {
    agentJobs.push({ businessId, chatId, messageId });
  },
  enqueueOwnerWhatsAppSend: async (businessId: string, messageId: string) => {
    sends.push({ businessId, messageId });
  },
}));

const { schema, withTenant } = await import('@fulcra/db');
const { eq } = await import('drizzle-orm');
const chats = await import('../src/owner-chat/chats');
const { saveOwnerAlertSettings } = await import('../src/alerts/settings');
const { getProduct } = await import('../src/catalog/products');
const { newBusiness, shopWithStock } = await import('./helpers');

/** A unique Nigerian mobile number, as WhatsApp sends it (no "+"). */
const newPhone = () => `23480${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const wamid = () => `wamid.${randomUUID()}`;

async function messagesOf(businessId: string, chatId: string) {
  return withTenant(businessId, (tx) =>
    tx
      .select()
      .from(schema.ownerChatMessages)
      .where(eq(schema.ownerChatMessages.chatId, chatId))
      .orderBy(schema.ownerChatMessages.createdAt),
  );
}

describe('owner chat on WhatsApp', () => {
  it('ignores numbers that are not an owner, and saves each message once', async () => {
    expect(
      await chats.receiveOwnerWhatsAppMessage({
        fromPhone: newPhone(),
        externalId: wamid(),
        text: 'hi',
      }),
    ).toEqual({ status: 'unknown' });

    const shop = await newBusiness('wa-owner');
    const phone = newPhone();
    await saveOwnerAlertSettings(shop.actor, { ownerWhatsapp: `+${phone}` });
    const id = wamid();
    const first = await chats.receiveOwnerWhatsAppMessage({
      fromPhone: phone,
      externalId: id,
      text: 'How much I sell today?',
    });
    expect(first).toMatchObject({ status: 'saved', businessId: shop.business.id });
    expect(agentJobs.at(-1)).toMatchObject({ businessId: shop.business.id });
    expect(
      await chats.receiveOwnerWhatsAppMessage({
        fromPhone: phone,
        externalId: id,
        text: 'How much I sell today?',
      }),
    ).toEqual({ status: 'duplicate' });
  });

  it('YES on WhatsApp runs the change; replies are queued and sent from Fulcra’s number', async () => {
    const shop = await shopWithStock(5);
    const phone = newPhone();
    await saveOwnerAlertSettings(shop.actor, { ownerWhatsapp: `0${phone.slice(3)}` }); // local format works
    const r = await chats.receiveOwnerWhatsAppMessage({
      fromPhone: phone,
      externalId: wamid(),
      text: 'Set ankara to 9',
    });
    if (r.status !== 'saved') throw new Error('not saved');
    const job = agentJobs.at(-1)!;
    const turn = (await chats.claimOwnerTurn(job.businessId, job.chatId, job.messageId))!;
    expect(turn.channel).toBe('whatsapp');
    const { summary } = await chats.proposeOwnerAction(turn, 'set_stock', {
      variantId: shop.variant.id,
      stock: 9,
    });
    const reply = await chats.saveOwnerReply(turn, `${summary}? Reply YES to confirm.`);
    if (reply.status !== 'saved') throw new Error('reply skipped');
    expect(sends.at(-1)).toEqual({ businessId: shop.business.id, messageId: reply.messageId });

    // The send job: claim, send, mark sent; a second claim finds nothing to do.
    expect(await chats.claimOwnerOutbound(shop.business.id, reply.messageId)).toEqual({
      to: phone,
      text: `${summary}? Reply YES to confirm.`,
    });
    await chats.markOwnerOutboundSent(shop.business.id, reply.messageId, 'wamid.out1');
    expect(await chats.claimOwnerOutbound(shop.business.id, reply.messageId)).toBeNull();
    expect(await chats.claimOwnerOutbound(shop.business.id, randomUUID())).toBe('missing');

    await chats.receiveOwnerWhatsAppMessage({ fromPhone: phone, externalId: wamid(), text: 'Oya' });
    expect((await getProduct(shop.actor, shop.product.id)).variants[0]!.stock).toBe(9);
    const msgs = await messagesOf(shop.business.id, r.chatId);
    const done = msgs.at(-1)!;
    expect(done).toMatchObject({ sender: 'assistant', status: 'queued' });
    expect(done.text).toContain('now has 9 in stock');
    expect(sends.at(-1)!.messageId).toBe(done.id);
  });

  it('a photo sent on WhatsApp is stored for the right business', async () => {
    const shop = await newBusiness('wa-photo');
    const phone = newPhone();
    await saveOwnerAlertSettings(shop.actor, { ownerWhatsapp: `+${phone}` });
    const photo = { path: `${shop.business.id}/${randomUUID()}`, width: 640, height: 640 };
    const loadPhoto = vi.fn(async () => photo);
    const r = await chats.receiveOwnerWhatsAppMessage(
      { fromPhone: phone, externalId: wamid(), text: 'New product: Kaftan, 20k, 3 pieces' },
      { loadPhoto },
    );
    expect(loadPhoto).toHaveBeenCalledWith(shop.business.id);
    if (r.status !== 'saved') throw new Error('not saved');
    const job = agentJobs.at(-1)!;
    expect((await chats.claimOwnerTurn(job.businessId, job.chatId, job.messageId))!.hasPhoto).toBe(
      true,
    );
  });

  it('one number with two businesses: answers for the last one used; "switch to" changes it', async () => {
    const a = await newBusiness('wa-alpha');
    const b = await newBusiness('wa-beta');
    const phone = newPhone();
    await saveOwnerAlertSettings(a.actor, { ownerWhatsapp: `+${phone}` });
    await saveOwnerAlertSettings(b.actor, { ownerWhatsapp: `+${phone}` });

    const first = await chats.receiveOwnerWhatsAppMessage({
      fromPhone: phone,
      externalId: wamid(),
      text: 'hello',
    });
    if (first.status !== 'saved') throw new Error('not saved');
    const chosen = first.businessId === a.business.id ? a : b;
    const other = chosen === a ? b : a;
    const note = (await messagesOf(first.businessId, first.chatId)).find(
      (m) => m.sender === 'assistant',
    )!;
    expect(note.text).toContain(
      `linked to 2 businesses. I'm answering for ${chosen.business.name}`,
    );

    const otherWord = other.business.name.split(' ')[0]!; // "wa-alpha" or "wa-beta"
    const switched = await chats.receiveOwnerWhatsAppMessage({
      fromPhone: phone,
      externalId: wamid(),
      text: `switch to ${otherWord}`,
    });
    expect(switched).toMatchObject({ status: 'saved', businessId: other.business.id });
    const confirm = (
      await messagesOf(other.business.id, (switched as { chatId: string }).chatId)
    ).at(-1)!;
    expect(confirm.text).toBe(`Okay, now we're talking about ${other.business.name}.`);

    const next = await chats.receiveOwnerWhatsAppMessage({
      fromPhone: phone,
      externalId: wamid(),
      text: 'how much today?',
    });
    expect(next).toMatchObject({ status: 'saved', businessId: other.business.id });
  });
});
