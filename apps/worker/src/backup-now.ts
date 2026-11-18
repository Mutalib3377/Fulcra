/** Runs one database backup now: `pnpm --filter @fulcra/worker backup` (or from the Render shell). */
import { runDatabaseBackup } from './jobs/backup';

const result = await runDatabaseBackup();
console.info('[backup]', result);
