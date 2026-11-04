import { APP_NAME } from '@fulcra/config';
import { loadEnv } from './env';
import { createQueue } from './queue';

async function main(): Promise<void> {
  const env = loadEnv();
  const boss = createQueue(env.DATABASE_URL);

  await boss.start();
  // Job handlers are registered here as phases add them (payments, agent replies, imports...).
  console.info(`[worker] ${APP_NAME} worker ready`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.info(`[worker] ${signal} received, stopping`);
    await boss.stop({ graceful: true, timeout: 20_000 });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('[worker] failed to start', error);
  process.exit(1);
});
