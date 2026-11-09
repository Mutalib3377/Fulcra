'use server';

import { sendHumanReply, sendTestCustomerMessage, setConversationHandler } from '@fulcra/core';
import type { ConversationHandler } from '@fulcra/core/rules';
import { toActionError, type ActionResult } from '@/lib/action-result';
import { getActionContext, SESSION_ENDED } from '@/lib/auth';

export async function sendReplyAction(conversationId: string, text: string): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await sendHumanReply(context.actor, conversationId, { text });
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setHandlerAction(
  conversationId: string,
  handler: ConversationHandler,
): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await setConversationHandler(context.actor, conversationId, handler);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

export async function sendTestMessageAction(text: string): Promise<ActionResult> {
  const context = await getActionContext();
  if (!context) return SESSION_ENDED;
  try {
    await sendTestCustomerMessage(context.actor, text);
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
