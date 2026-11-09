/**
 * @fulcra/agent — the AI sales assistant: instructions, tools and the reply loop.
 * Channel-agnostic (rule 3); every fact and action goes through Core (rule 10).
 */
export {
  AGENT_MODEL,
  agentClientFromEnv,
  historyToMessages,
  runAgentTurn,
  type TurnResult,
} from './run';
export { buildSystemPrompt, turnNote } from './prompt';
export { TOOLS } from './tools';
