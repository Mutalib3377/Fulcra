/**
 * Which model does what (docs/decisions/0011 and 0012). Replies need judgement and tool use;
 * describing a photo is simple vision work for the cheapest model. Both can be changed with
 * environment variables, for example to try a cheaper reply model after measuring.
 */
export const AGENT_MODEL = 'claude-opus-5-5';
export const PHOTO_MODEL = 'claude-haiku-5-5';

export type AgentModels = { reply: string; photo: string };

export function agentModelsFromEnv(env: NodeJS.ProcessEnv = process.env): AgentModels {
  return {
    reply: env.AGENT_MODEL?.trim() || AGENT_MODEL,
    photo: env.AGENT_PHOTO_MODEL?.trim() || PHOTO_MODEL,
  };
}

/**
 * Server-side fallback (a refused request is retried on another model) where the model
 * offers it. Haiku models reject the parameter.
 */
export function withFallback(model: string) {
  return model.startsWith('claude-haiku')
    ? {}
    : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
}
