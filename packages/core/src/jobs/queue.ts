import { getDatabaseUrl } from '@fulcra/db';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';

/**
 * Background jobs (pg-boss on our Postgres). Job names and payloads are defined here so the
 * web app (sender) and the worker (handler) agree. Slow work goes here (rule 8).
 */
export const JOBS = {
  /** Process a saved Paystack webhook: confirm payment, mark order paid. */
  paystackWebhook: {
    name: 'paystack-webhook',
    data: z.object({ webhookEventId: z.uuid() }),
  },
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS]['name'];

let sender: Promise<PgBoss> | undefined;

/** A queue client for sending jobs only (the web app). The worker runs its own. */
function getSender(): Promise<PgBoss> {
  sender ??= (async () => {
    const boss = new PgBoss({
      connectionString: getDatabaseUrl(),
      schema: 'pgboss',
      application_name: 'fulcra-web',
      supervise: false,
      schedule: false,
      max: 2,
    });
    boss.on('error', (error) => console.error('[queue] error', error));
    await boss.start();
    await ensureQueues(boss);
    return boss;
  })();
  sender.catch(() => {
    sender = undefined;
  });
  return sender;
}

/** Creates every queue we use (safe to call repeatedly). */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const job of Object.values(JOBS)) {
    if (!(await boss.getQueue(job.name))) await boss.createQueue(job.name);
  }
}

/** Retries with backoff: a webhook keeps trying for about an hour if Paystack or the DB hiccups. */
const RETRY = { retryLimit: 8, retryDelay: 15, retryBackoff: true } as const;

export async function enqueuePaystackWebhook(webhookEventId: string): Promise<void> {
  const data = JOBS.paystackWebhook.data.parse({ webhookEventId });
  const boss = await getSender();
  // singletonKey: the same webhook is never queued twice at once.
  await boss.send(JOBS.paystackWebhook.name, data, { ...RETRY, singletonKey: webhookEventId });
}
