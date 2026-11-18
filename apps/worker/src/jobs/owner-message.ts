import { agentClientFromEnv, agentModelsFromEnv, runOwnerTurn } from '@fulcra/agent';
import { JOBS } from '@fulcra/core';
import type { Job } from 'pg-boss';

const client = agentClientFromEnv();
const models = agentModelsFromEnv();

/** The owner's assistant answers an owner message (O1). Temporary AI errors throw: retried. */
export async function handleOwnerMessage(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { businessId, chatId, messageId } = JOBS.ownerMessage.data.parse(job.data);
    const result = await runOwnerTurn({
      businessId,
      chatId,
      messageId,
      client,
      model: models.reply,
    });
    console.info(`[worker] owner message ${chatId}: ${result.status}`);
  }
}
