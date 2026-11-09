import { agentClientFromEnv, agentModelsFromEnv, runAgentTurn } from '@fulcra/agent';
import { JOBS } from '@fulcra/core';
import type { Job } from 'pg-boss';

const client = agentClientFromEnv();
const models = agentModelsFromEnv();

/** The assistant answers a chat. Temporary AI errors throw, so pg-boss retries. */
export async function handleAgentReply(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { businessId, conversationId, messageId } = JOBS.agentReply.data.parse(job.data);
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
