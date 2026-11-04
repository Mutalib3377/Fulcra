import { PgBoss } from 'pg-boss';

/**
 * Creates the pg-boss queue on our Postgres. pg-boss keeps its own tables in the
 * `pgboss` schema and creates/migrates them on start().
 */
export function createQueue(connectionString: string): PgBoss {
  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
    application_name: 'fulcra-worker',
  });
  boss.on('error', (error) => console.error('[worker] queue error', error));
  return boss;
}
