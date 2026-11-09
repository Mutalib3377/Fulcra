import { agentClientFromEnv, agentModelsFromEnv, runAgentTurn } from '@fulcra/agent';
import { adapterFor } from '@fulcra/channels';
import { JOBS, readReceiptTarget } from '@fulcra/core';
import type { Job } from 'pg-boss';

const client = agentClientFromEnv();
const models = agentModelsFromEnv();

/** The assistant answers a chat. Temporary AI errors throw, so pg-boss retries. */
export async function handleAgentReply(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { businessId, conversationId, messageId } = JOBS.agentReply.data.parse(job.data);
    await showTyping(businessId, messageId);
    const result = await runAgentTurn({
      businessId,
      conversationId,
      messageId,
      client,
      model: models.reply,
      photoModel: models.photo,
    });
    console.info(`[worker] agent reply ${conversationId}: ${result.status}`);
  }
}

/** "Seen" ticks and "typing…" on the customer's phone while the assistant works (best effort). */
async function showTyping(businessId: string, messageId: string): Promise<void> {
  try {
    const target = await readReceiptTarget(businessId, messageId);
    const adapter = target && adapterFor(target.channel);
    if (!target || !adapter?.markRead) return;
    await adapter.markRead({
      accountId: target.externalAccountId,
      credentials: target.credentials,
      externalMessageId: target.externalMessageId,
      typing: true,
    });
  } catch (error) {
    console.warn('[worker] could not show typing', error instanceof Error ? error.message : error);
  }
}
