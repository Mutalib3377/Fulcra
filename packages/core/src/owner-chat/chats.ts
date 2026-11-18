import { schema, withSystem, withTenant, type Tx } from '@fulcra/db';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { planStateInTx } from '../billing/entitlements';
import { enqueueOwnerMessage, enqueueOwnerWhatsAppSend } from '../jobs/queue';
import { isOwnImagePath } from '../media/images';
import { requireMember, type ActorContext } from '../members/access';
import { CoreError } from '../shared/errors';
import { describeOwnerAction, executeOwnerAction, type OwnerActionKind } from './actions';
import {
  isConfirmation,
  isRefusal,
  OWNER_MESSAGES_PER_MONTH,
  PENDING_ACTION_MINUTES,
  TRIAL_OWNER_MESSAGES,
} from './rules';

/**
 * The owner's own chat with the assistant (O1). Owner messages are saved, then: a YES or NO to
 * a waiting change is handled here without the AI; over the monthly limit or without the
 * feature, a plain reply; otherwise the `owner-message` job asks the assistant.
 */
const OWNER = ['owner'] as const;
const DASHBOARD_USER = 'dashboard';
const c = schema.ownerChats;
const m = schema.ownerChatMessages;

export type OwnerChatLimit = { used: number; limit: number };

async function chatFor(
  tx: Tx,
  businessId: string,
  channel: schema.OwnerChatChannel,
  externalUserId: string,
): Promise<schema.OwnerChat> {
  const [existing] = await tx
    .select()
    .from(c)
    .where(and(eq(c.channel, channel), eq(c.externalUserId, externalUserId)))
    .limit(1);
  if (existing) return existing;
  const [created] = await tx
    .insert(c)
    .values({ businessId, channel, externalUserId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [raced] = await tx
    .select()
    .from(c)
    .where(and(eq(c.channel, channel), eq(c.externalUserId, externalUserId)))
    .limit(1);
  return raced!;
}

/** Owner messages this calendar month (business time zone) and the plan's allowance. */
async function limitInTx(tx: Tx, now: Date): Promise<OwnerChatLimit> {
  const state = await planStateInTx(tx, now);
  const [b] = await tx.select({ tz: schema.businesses.timezone }).from(schema.businesses).limit(1);
  const tz = b?.tz ?? 'Africa/Lagos';
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(m)
    .where(
      and(
        eq(m.sender, 'owner'),
        sql`date_trunc('month', ${m.createdAt} at time zone ${tz}) = date_trunc('month', ${now.toISOString()}::timestamptz at time zone ${tz})`,
      ),
    );
  return {
    used: row?.n ?? 0,
    limit: state.status === 'trialing' ? TRIAL_OWNER_MESSAGES : OWNER_MESSAGES_PER_MONTH,
  };
}

async function addAssistantMessage(
  tx: Tx,
  chat: schema.OwnerChat,
  text: string,
): Promise<schema.OwnerChatMessage> {
  const [message] = await tx
    .insert(m)
    .values({
      businessId: chat.businessId,
      chatId: chat.id,
      sender: 'assistant',
      text,
      // Dashboard replies are read in place; WhatsApp replies are sent by a job (O1b).
      status: chat.channel === 'dashboard' ? 'sent' : 'queued',
    })
    .returning();
  await tx.update(c).set({ lastMessageAt: new Date() }).where(eq(c.id, chat.id));
  return message!;
}

/** The owner's member account: the assistant acts as the owner (same rules as the dashboard). */
async function ownerActorInTx(tx: Tx, businessId: string): Promise<ActorContext> {
  const [owner] = await tx
    .select({ userId: schema.members.userId })
    .from(schema.members)
    .where(eq(schema.members.role, 'owner'))
    .orderBy(asc(schema.members.createdAt))
    .limit(1);
  if (!owner) throw new CoreError('not_found', 'This business has no owner.');
  return { businessId, userId: owner.userId };
}

export const ownerMessageInput = z.object({
  text: z.string().trim().max(2000).default(''),
  image: z
    .object({ path: z.string().min(1), width: z.number().int(), height: z.number().int() })
    .nullish()
    .transform((v) => v ?? null),
});

type Outcome = {
  kind: 'confirm' | 'refuse' | 'agent' | 'reply';
  text?: string;
  /** A reply saved here (to send on WhatsApp after the transaction). */
  reply?: schema.OwnerChatMessage;
};

/**
 * Saves an owner message and decides what happens next. The caller runs a confirmed change
 * (outside this transaction) or queues the assistant.
 */
async function takeOwnerMessageInTx(
  tx: Tx,
  chat: schema.OwnerChat,
  input: { text: string; image: schema.StoredImage | null; externalId?: string },
  now: Date,
): Promise<{ message: schema.OwnerChatMessage | null; outcome: Outcome }> {
  const [message] = await tx
    .insert(m)
    .values({
      businessId: chat.businessId,
      chatId: chat.id,
      sender: 'owner',
      text: input.text,
      image: input.image,
      externalId: input.externalId ?? null,
      status: 'received',
    })
    .onConflictDoNothing()
    .returning();
  if (!message) return { message: null, outcome: { kind: 'reply' } }; // already saved
  await tx.update(c).set({ lastMessageAt: now }).where(eq(c.id, chat.id));

  const pendingLive =
    chat.pendingAction && chat.pendingExpiresAt && chat.pendingExpiresAt.getTime() > now.getTime();
  if (pendingLive && !input.image && isConfirmation(input.text))
    return { message, outcome: { kind: 'confirm' } };
  if (pendingLive && !input.image && isRefusal(input.text))
    return { message, outcome: { kind: 'refuse' } };
  if (chat.pendingAction) {
    // Anything else replaces the waiting change: the owner moved on.
    await tx
      .update(c)
      .set({ pendingAction: null, pendingExpiresAt: null })
      .where(eq(c.id, chat.id));
  }

  const state = await planStateInTx(tx, now);
  if (!state.features.has('owner_assistant')) {
    const text = state.active
      ? 'Your plan does not include the assistant chat. Upgrade in Settings → Billing to use it.'
      : 'Your Fulcra plan has ended. Choose a plan in Settings → Billing to use the assistant chat again.';
    const reply = await addAssistantMessage(tx, chat, text);
    return { message, outcome: { kind: 'reply', text, reply } };
  }
  const limit = await limitInTx(tx, now);
  if (limit.used > limit.limit) {
    const text = `You've used your ${limit.limit} assistant messages for this month. Everything is still on your dashboard, and the count starts again next month.`;
    const reply = await addAssistantMessage(tx, chat, text);
    return { message, outcome: { kind: 'reply', text, reply } };
  }
  return { message, outcome: { kind: 'agent' } };
}

/** Runs or drops the waiting change after a YES or NO, and replies. */
async function settlePending(
  businessId: string,
  chatId: string,
  outcome: 'confirm' | 'refuse',
): Promise<void> {
  const { chat, action, actor, photo } = await withTenant(businessId, async (tx) => {
    const [current] = await tx.select().from(c).where(eq(c.id, chatId)).limit(1);
    if (!current) throw new CoreError('not_found', 'Chat not found.');
    // Taken once: a double YES can't run the change twice.
    await tx.update(c).set({ pendingAction: null, pendingExpiresAt: null }).where(eq(c.id, chatId));
    const [lastPhoto] = await tx
      .select({ image: m.image })
      .from(m)
      .where(and(eq(m.chatId, chatId), eq(m.sender, 'owner'), sql`${m.image} is not null`))
      .orderBy(desc(m.createdAt))
      .limit(1);
    return {
      chat: current,
      action: current.pendingAction,
      actor: await ownerActorInTx(tx, businessId),
      photo: lastPhoto?.image ?? null,
    };
  });
  let reply: string;
  if (!action) reply = 'There is nothing waiting for a yes right now.';
  else if (outcome === 'refuse') reply = "Okay, I won't do that.";
  else {
    try {
      reply = await executeOwnerAction(actor, action, photo);
    } catch (error) {
      reply =
        error instanceof CoreError
          ? `I couldn't do that: ${error.message}`
          : 'Something went wrong and nothing was changed. Please try again.';
      if (!(error instanceof CoreError)) console.error('[owner-chat] action failed', error);
    }
  }
  const saved = await withTenant(businessId, (tx) => addAssistantMessage(tx, chat, reply));
  await sendIfWhatsApp(chat, saved);
}

/** WhatsApp replies are sent by a job, after the message is saved (O1b). */
async function sendIfWhatsApp(
  chat: Pick<schema.OwnerChat, 'channel' | 'businessId'>,
  message: Pick<schema.OwnerChatMessage, 'id'> | undefined,
): Promise<void> {
  if (chat.channel === 'whatsapp' && message)
    await enqueueOwnerWhatsAppSend(chat.businessId, message.id);
}

async function afterTake(
  chat: schema.OwnerChat,
  taken: { message: schema.OwnerChatMessage | null; outcome: Outcome },
): Promise<void> {
  const { businessId, id: chatId } = chat;
  if (!taken.message) return;
  if (taken.outcome.reply) await sendIfWhatsApp(chat, taken.outcome.reply);
  if (taken.outcome.kind === 'confirm' || taken.outcome.kind === 'refuse')
    await settlePending(businessId, chatId, taken.outcome.kind);
  else if (taken.outcome.kind === 'agent')
    await enqueueOwnerMessage(businessId, chatId, taken.message.id);
}

// ─── Dashboard door ─────────────────────────────────────────────────────────

/** The owner writes in the dashboard's "Ask Fulcra" chat. */
export async function sendOwnerDashboardMessage(
  actor: ActorContext,
  input: z.input<typeof ownerMessageInput>,
  now = new Date(),
): Promise<{ messageId: string }> {
  const data = ownerMessageInput.parse(input);
  if (!data.text && !data.image) throw new CoreError('validation', 'Type a message.');
  if (data.image && !isOwnImagePath(actor.businessId, data.image.path))
    throw new CoreError('validation', 'This photo could not be used. Please upload it again.');
  const { chat, taken } = await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, OWNER);
    const chat = await chatFor(tx, actor.businessId, 'dashboard', DASHBOARD_USER);
    return { chat, taken: await takeOwnerMessageInTx(tx, chat, data, now) };
  });
  await afterTake(chat, taken);
  return { messageId: taken.message!.id };
}

export type OwnerChatView = {
  messages: Pick<schema.OwnerChatMessage, 'id' | 'sender' | 'text' | 'image' | 'createdAt'>[];
  pending: { summary: string; expiresAt: Date } | null;
  limit: OwnerChatLimit;
  /** The assistant is still working on the newest owner message. */
  thinking: boolean;
};

/** The dashboard chat: the latest messages (or those after a time), the waiting change, usage. */
export async function getOwnerDashboardChat(
  actor: ActorContext,
  options: { after?: Date } = {},
  now = new Date(),
): Promise<OwnerChatView> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, OWNER);
    const [chat] = await tx
      .select()
      .from(c)
      .where(and(eq(c.channel, 'dashboard'), eq(c.externalUserId, DASHBOARD_USER)))
      .limit(1);
    const limit = await limitInTx(tx, now);
    if (!chat) return { messages: [], pending: null, limit, thinking: false };
    const rows = await tx
      .select({ id: m.id, sender: m.sender, text: m.text, image: m.image, createdAt: m.createdAt })
      .from(m)
      .where(and(eq(m.chatId, chat.id), options.after ? gt(m.createdAt, options.after) : undefined))
      .orderBy(desc(m.createdAt))
      .limit(50);
    const messages = rows.reverse();
    const [last] = await tx
      .select({ sender: m.sender })
      .from(m)
      .where(eq(m.chatId, chat.id))
      .orderBy(desc(m.createdAt))
      .limit(1);
    const pending =
      chat.pendingAction && chat.pendingExpiresAt && chat.pendingExpiresAt > now
        ? { summary: chat.pendingAction.summary, expiresAt: chat.pendingExpiresAt }
        : null;
    return { messages, pending, limit, thinking: last?.sender === 'owner' };
  });
}

// ─── For the assistant (worker) ─────────────────────────────────────────────

export type OwnerTurn = {
  businessId: string;
  chatId: string;
  channel: schema.OwnerChatChannel;
  /** Acts as the owner: every tool runs with the owner's permissions. */
  actor: ActorContext;
  businessName: string;
  timezone: string;
  history: Pick<schema.OwnerChatMessage, 'sender' | 'text' | 'image' | 'createdAt'>[];
  /** The newest owner message included a photo (usable for a new product). */
  hasPhoto: boolean;
};

/** The turn for the newest owner message, or null if a newer one arrived or it was answered. */
export async function claimOwnerTurn(
  businessId: string,
  chatId: string,
  messageId: string,
): Promise<OwnerTurn | null> {
  return withTenant(businessId, async (tx) => {
    const [chat] = await tx.select().from(c).where(eq(c.id, chatId)).limit(1);
    if (!chat) return null;
    const recent = await tx
      .select({ id: m.id, sender: m.sender, text: m.text, image: m.image, createdAt: m.createdAt })
      .from(m)
      .where(eq(m.chatId, chatId))
      .orderBy(desc(m.createdAt))
      .limit(20);
    if (recent[0]?.id !== messageId || recent[0].sender !== 'owner') return null;
    const [b] = await tx
      .select({ name: schema.businesses.name, tz: schema.businesses.timezone })
      .from(schema.businesses)
      .limit(1);
    return {
      businessId,
      chatId,
      channel: chat.channel,
      actor: await ownerActorInTx(tx, businessId),
      businessName: b?.name ?? '',
      timezone: b?.tz ?? 'Africa/Lagos',
      history: recent.reverse(),
      hasPhoto: Boolean(recent.at(-1)?.image),
    };
  });
}

/** The assistant proposes a change: checked, saved for the owner's YES, described. */
export async function proposeOwnerAction(
  turn: OwnerTurn,
  kind: OwnerActionKind,
  input: unknown,
  now = new Date(),
): Promise<{ summary: string }> {
  const proposal = await describeOwnerAction(turn.actor, kind, input, turn.hasPhoto);
  await withTenant(turn.businessId, (tx) =>
    tx
      .update(c)
      .set({
        pendingAction: {
          kind: proposal.kind,
          params: proposal.params as Record<string, unknown>,
          summary: proposal.summary,
        },
        pendingExpiresAt: new Date(now.getTime() + PENDING_ACTION_MINUTES * 60_000),
      })
      .where(eq(c.id, turn.chatId)),
  );
  return { summary: proposal.summary };
}

/** The assistant's reply (only if no newer owner message arrived meanwhile). */
export async function saveOwnerReply(
  turn: OwnerTurn,
  text: string,
): Promise<{ status: 'saved'; messageId: string } | { status: 'skipped' }> {
  const body = z.string().trim().min(1).max(4096).parse(text);
  const result = await withTenant(turn.businessId, async (tx) => {
    const [chat] = await tx.select().from(c).where(eq(c.id, turn.chatId)).limit(1);
    const [latest] = await tx
      .select({ sender: m.sender, createdAt: m.createdAt })
      .from(m)
      .where(eq(m.chatId, turn.chatId))
      .orderBy(desc(m.createdAt))
      .limit(1);
    const newestSeen = turn.history.at(-1)?.createdAt.getTime() ?? 0;
    if (!chat || (latest && latest.createdAt.getTime() > newestSeen))
      return { status: 'skipped' as const };
    const message = await addAssistantMessage(tx, chat, body);
    return { status: 'saved' as const, messageId: message.id, chat };
  });
  if (result.status === 'skipped') return result;
  await sendIfWhatsApp(result.chat, { id: result.messageId });
  return { status: 'saved', messageId: result.messageId };
}

// ─── WhatsApp door (O1b) ────────────────────────────────────────────────────

export type OwnerWhatsAppResult =
  | { status: 'unknown' }
  | { status: 'duplicate' }
  | { status: 'saved'; businessId: string; chatId: string };

const SWITCH = /^\s*(?:switch|change)\s+(?:to\s+)?(.+?)\s*$/i;

/**
 * A message to Fulcra's WhatsApp number. The sender is recognised by the alert number saved in
 * Settings → Alerts (`owner_whatsapp`), so the WhatsApp number is the owner's key. A number
 * linked to several businesses talks to the one used last; "switch to <name>" changes it.
 * Unknown numbers get `unknown` (the worker sends a short explanation).
 */
export async function receiveOwnerWhatsAppMessage(
  input: { fromPhone: string; externalId: string; text: string },
  options: {
    /** Stores the photo for the chosen business (the worker downloads it from WhatsApp). */
    loadPhoto?: (businessId: string) => Promise<schema.StoredImage | null>;
    now?: Date;
  } = {},
): Promise<OwnerWhatsAppResult> {
  const now = options.now ?? new Date();
  const phone = `+${input.fromPhone.replace(/\D/g, '')}`;
  const text = input.text.trim().slice(0, 2000);

  // Which businesses this number owns, and when each was last talked to (cross-business by
  // nature: docs/decisions/0003).
  const options_ = await withSystem((tx) =>
    tx
      .select({
        businessId: schema.businesses.id,
        name: schema.businesses.name,
        lastMessageAt: c.lastMessageAt,
      })
      .from(schema.ownerNotificationSettings)
      .innerJoin(
        schema.businesses,
        eq(schema.businesses.id, schema.ownerNotificationSettings.businessId),
      )
      .leftJoin(
        c,
        and(
          eq(c.businessId, schema.businesses.id),
          eq(c.channel, 'whatsapp'),
          eq(c.externalUserId, phone),
        ),
      )
      .where(eq(schema.ownerNotificationSettings.ownerWhatsapp, phone)),
  );
  if (options_.length === 0) return { status: 'unknown' };

  const byRecent = [...options_].sort(
    (a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0),
  );
  const wanted = options_.length > 1 ? SWITCH.exec(text)?.[1]?.toLowerCase() : undefined;
  const switchedTo = wanted
    ? options_.find((o) => o.name.toLowerCase().includes(wanted))
    : undefined;
  const chosen = switchedTo ?? byRecent[0]!;
  const firstTime = !chosen.lastMessageAt;
  const image =
    !switchedTo && options.loadPhoto ? await options.loadPhoto(chosen.businessId) : null;

  const { chat, taken, notes } = await withTenant(chosen.businessId, async (tx) => {
    const chat = await chatFor(tx, chosen.businessId, 'whatsapp', phone);
    const notes: schema.OwnerChatMessage[] = [];
    if (switchedTo) {
      // Handled here, not by the AI: save the request and confirm the switch.
      const [saved] = await tx
        .insert(m)
        .values({
          businessId: chosen.businessId,
          chatId: chat.id,
          sender: 'owner',
          text,
          externalId: input.externalId,
          status: 'received',
        })
        .onConflictDoNothing()
        .returning();
      if (!saved)
        return { chat, taken: { message: null, outcome: { kind: 'reply' as const } }, notes };
      notes.push(
        await addAssistantMessage(tx, chat, `Okay, now we're talking about ${chosen.name}.`),
      );
      return { chat, taken: { message: saved, outcome: { kind: 'reply' as const } }, notes };
    }
    const taken = await takeOwnerMessageInTx(
      tx,
      chat,
      { text, image, externalId: input.externalId },
      now,
    );
    if (taken.message && firstTime && options_.length > 1) {
      const others = options_.filter((o) => o.businessId !== chosen.businessId).map((o) => o.name);
      notes.push(
        await addAssistantMessage(
          tx,
          chat,
          `This number is linked to ${options_.length} businesses. I'm answering for ${chosen.name}. To change, write "switch to ${others[0]}".`,
        ),
      );
    }
    return { chat, taken, notes };
  });
  if (!taken.message) return { status: 'duplicate' };
  for (const note of notes) await sendIfWhatsApp(chat, note);
  await afterTake(chat, taken);
  return { status: 'saved', businessId: chosen.businessId, chatId: chat.id };
}

/** An owner-chat reply waiting to go out on WhatsApp: who to and what. Null when not queued. */
export async function claimOwnerOutbound(
  businessId: string,
  messageId: string,
): Promise<{ to: string; text: string } | 'missing' | null> {
  return withTenant(businessId, async (tx) => {
    const [row] = await tx
      .select({ message: m, chat: c })
      .from(m)
      .innerJoin(c, eq(c.id, m.chatId))
      .where(eq(m.id, messageId))
      .limit(1);
    if (!row) return 'missing';
    if (row.message.status !== 'queued' || row.chat.channel !== 'whatsapp') return null;
    // WhatsApp wants the number without "+".
    return { to: row.chat.externalUserId.replace(/^\+/, ''), text: row.message.text };
  });
}

export async function markOwnerOutboundSent(
  businessId: string,
  messageId: string,
  externalId: string,
): Promise<void> {
  await withTenant(businessId, (tx) =>
    tx.update(m).set({ status: 'sent', externalId }).where(eq(m.id, messageId)),
  );
}

export async function markOwnerOutboundFailed(
  businessId: string,
  messageId: string,
): Promise<void> {
  await withTenant(businessId, (tx) =>
    tx.update(m).set({ status: 'failed' }).where(eq(m.id, messageId)),
  );
}
