import Anthropic from '@anthropic-ai/sdk';
import {
  amountsInData,
  amountsInText,
  assistantHandOff,
  claimAgentTurn,
  priorReplyTexts,
  queueAgentReply,
  recordAgentAction,
  recordAiUsage,
  toolErrorMessage,
  unverifiedAmounts,
  type AgentTurn,
} from '@fulcra/core';
import { AGENT_MODEL, PHOTO_MODEL, withFallback } from './models';
import { describeNewPhotos, photoNote } from './photos';
import { buildSystemPrompt, turnNote } from './prompt';
import { runTool, TOOLS } from './tools';

/** Chat replies are simple work; low effort keeps them fast and cheap. */
const AGENT_EFFORT = 'low' as const;
/** Tool rounds per reply before giving up and handing off. */
const MAX_ROUNDS = 8;
const AWAY_REPEAT_HOURS = 12;

export type TurnResult =
  | { status: 'skipped' }
  | { status: 'replied'; messageId: string; handedOff: boolean }
  | { status: 'away' }
  | { status: 'handed_off'; reason: string }
  | { status: 'not_sent'; reason: string };

/** The Claude client for the assistant, or null when ANTHROPIC_API_KEY is not set. */
export function agentClientFromEnv(env: NodeJS.ProcessEnv = process.env): Anthropic | null {
  return env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
}

const MEDIA_NOTE: Record<string, string> = {
  image: '[The customer sent a photo you could not see. Ask what it shows.]',
  audio: '[The customer sent a voice note you cannot listen to.]',
  video: '[The customer sent a video.]',
  document: '[The customer sent a file.]',
  location: '[The customer shared a location.]',
  unsupported: '[The customer sent a message type you cannot read.]',
};

/** The chat as alternating user/assistant turns (plain text; earlier reasoning is never replayed). */
export function historyToMessages(turn: AgentTurn): Anthropic.Beta.BetaMessageParam[] {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of turn.history) {
    const role = m.sender === 'customer' ? 'user' : 'assistant';
    const label = m.sender === 'human' ? '[A person from the team wrote:] ' : '';
    const media = m.photo ? photoNote(m.photo) : m.type === 'image' ? MEDIA_NOTE.image : '';
    const body = media
      ? [media, m.text].filter(Boolean).join('\n')
      : m.text || MEDIA_NOTE[m.type] || '';
    const text = `${label}${body}`.trim();
    if (!text) continue;
    const prev = messages.at(-1);
    if (prev && prev.role === role && typeof prev.content === 'string')
      prev.content = `${prev.content}\n${text}`;
    else messages.push({ role, content: text });
  }
  while (messages[0]?.role === 'assistant') messages.shift(); // must start with the customer
  return messages;
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Answers a chat: one "turn" for the newest customer message (worker job). Every fact comes
 * from tools (Core); every AI call is logged with its cost; every tool call is audited; a
 * reply with an amount that did not come from a tool is never sent.
 */
export async function runAgentTurn(params: {
  businessId: string;
  conversationId: string;
  messageId?: string;
  client: Anthropic | null;
  /** The reply model (default AGENT_MODEL). */
  model?: string;
  /** The model that describes photos (default PHOTO_MODEL). */
  photoModel?: string;
  now?: Date;
}): Promise<TurnResult> {
  const { businessId, conversationId, client } = params;
  const turn = await claimAgentTurn(businessId, conversationId, params.messageId);
  if (!turn) return { status: 'skipped' };

  const handOff = async (reason: string): Promise<TurnResult> => {
    await assistantHandOff(businessId, conversationId, reason);
    return { status: 'handed_off', reason };
  };

  if (!client) return handOff('The assistant is not set up yet (no AI key)');

  // Closed and not taking orders: the away message (once), then the chat waits for the team.
  if (!turn.open && !turn.settings.afterHoursOrders) {
    const away =
      turn.settings.awayMessage ||
      `Thanks for your message! We're closed right now (${turn.hoursText}). We'll reply as soon as we open.`;
    const since = Date.now() - AWAY_REPEAT_HOURS * 3_600_000;
    const alreadySent = turn.history.some(
      (h) => h.sender === 'agent' && h.text === away && h.createdAt.getTime() > since,
    );
    if (alreadySent) return handOff('Customer wrote while you were closed');
    await queueAgentReply(businessId, conversationId, away, {
      answeringInboundId: turn.lastInboundId,
    });
    return { status: 'away' };
  }

  const model = params.model ?? AGENT_MODEL;
  await describeNewPhotos(turn, client, params.photoModel ?? PHOTO_MODEL);

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: buildSystemPrompt(turn), cache_control: { type: 'ephemeral' } },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...historyToMessages(turn),
    { role: 'system', content: turnNote(turn, params.now) },
  ];
  // Amounts the reply may repeat: from tools this turn, or already said in this chat.
  const allowed = new Set<number>();
  for (const text of await priorReplyTexts(businessId, conversationId))
    amountsInText(text).forEach((a) => allowed.add(a));
  let pendingHandOff: string | null = null;
  let reply = '';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 8000,
        // A refused request is retried on another model instead of failing.
        ...withFallback(model),
        output_config: { effort: AGENT_EFFORT },
        system,
        tools: TOOLS,
        messages,
        // Caches the conversation so far between tool rounds.
        cache_control: { type: 'ephemeral' },
      });
    } catch (error) {
      if (
        error instanceof Anthropic.RateLimitError ||
        error instanceof Anthropic.InternalServerError ||
        error instanceof Anthropic.APIConnectionError
      ) {
        throw error; // temporary: the job is retried
      }
      if (error instanceof Anthropic.APIError) {
        console.error('[agent] AI call failed', error.status, error.message);
        return handOff('The assistant could not reply (AI service error)');
      }
      throw error;
    }
    await recordAiUsage(businessId, {
      feature: 'agent.reply',
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    });

    if (response.stop_reason === 'refusal')
      return handOff('The assistant could not answer this message');
    if (response.stop_reason === 'max_tokens')
      return handOff('The assistant could not finish its reply');

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
    );
    if (toolUses.length === 0) {
      reply = textOf(response.content);
      break;
    }
    // Sent back unchanged (with any reasoning blocks) so the model keeps its train of thought.
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of toolUses) {
      try {
        const outcome = await runTool(turn, call.name, call.input);
        if (outcome.handOff) pendingHandOff = outcome.handOff;
        amountsInData(outcome.output, allowed);
        await recordAgentAction(businessId, conversationId, {
          tool: call.name,
          input: call.input,
          output: outcome.output,
          ok: true,
        });
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(outcome.output),
        });
      } catch (error) {
        const message = toolErrorMessage(error);
        await recordAgentAction(businessId, conversationId, {
          tool: call.name,
          input: call.input,
          output: { error: message },
          ok: false,
        });
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: message,
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: results });
    if (round === MAX_ROUNDS - 1)
      return handOff('The assistant needed too many steps for this message');
  }

  if (!reply) return handOff(pendingHandOff ?? 'The assistant had nothing to say');

  // The guard: no amount the database did not give (rule 10).
  const unverified = unverifiedAmounts(reply, allowed);
  if (unverified.length > 0) {
    await recordAgentAction(businessId, conversationId, {
      tool: 'priceCheck',
      input: { reply },
      output: { blocked: true, amounts: unverified },
      ok: false,
    });
    await handOff('The assistant was unsure about a price');
    return {
      status: 'not_sent',
      reason: `amounts not from the database: ${unverified.join(', ')}`,
    };
  }

  const queued = await queueAgentReply(businessId, conversationId, reply, {
    answeringInboundId: turn.lastInboundId,
  });
  if (queued.status === 'skipped') return { status: 'skipped' };
  if (pendingHandOff) await assistantHandOff(businessId, conversationId, pendingHandOff);
  return { status: 'replied', messageId: queued.messageId, handedOff: Boolean(pendingHandOff) };
}
