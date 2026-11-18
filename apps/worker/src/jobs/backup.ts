import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deletePrivateFiles, listPrivateFiles, putPrivateFile } from '@fulcra/core';

/** How many weekly backups to keep (about two months). */
export const BACKUPS_KEPT = 8;
const PREFIX = 'database/';

export type BackupResult =
  | { status: 'skipped'; reason: string }
  | { status: 'saved'; keys: string[]; bytes: number; deleted: number };

/**
 * Dumps the business data to a private bucket (BACKUP_BUCKET), keeping the last BACKUPS_KEPT.
 * Supabase's free plan has no automatic backups, so this is the safety net until Pro.
 * Each backup is two files with the same timestamp:
 * - `…-business.dump`: the `public` schema (all business data) and migration history;
 * - `…-accounts.dump`: sign-in accounts (`auth.users`, `auth.identities`), data only, to load
 *   into a new Supabase project's own auth tables so owners keep their businesses.
 * (Two files because pg_dump ignores schema options as soon as a table option is given.)
 * Needs `pg_dump` (installed in the free hosting image) and a direct or session connection.
 */
export async function runDatabaseBackup(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): Promise<BackupResult> {
  const bucket = env.BACKUP_BUCKET;
  if (!bucket) return { status: 'skipped', reason: 'BACKUP_BUCKET is not set' };
  // pg_dump needs a real session: direct connection or session pooler, not the transaction pooler.
  const url = env.DATABASE_URL_MIGRATIONS || env.DATABASE_URL_QUEUE || env.DATABASE_URL;
  if (!url) return { status: 'skipped', reason: 'no database connection set' };

  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const parts = [
    { name: 'business', args: ['--schema=public', '--schema=drizzle'] },
    { name: 'accounts', args: ['--data-only', '--table=auth.users', '--table=auth.identities'] },
  ];
  const files = parts.map((p) => ({
    ...p,
    file: path.join(tmpdir(), `fulcra-${stamp}-${p.name}.dump`),
  }));
  try {
    for (const part of files) await pgDump(url, part.file, part.args);
    let bytes = 0;
    const keys: string[] = [];
    for (const part of files) {
      const { size } = await stat(part.file);
      const key = `${PREFIX}fulcra-${stamp}-${part.name}.dump`;
      await putPrivateFile(bucket, key, createReadStream(part.file), size);
      bytes += size;
      keys.push(key);
    }
    // Keep the newest BACKUPS_KEPT backups (a backup = all files sharing a timestamp).
    const all = (await listPrivateFiles(bucket, PREFIX)).filter((k) => k.endsWith('.dump'));
    const stampOf = (k: string) =>
      k.slice(PREFIX.length).replace(/-(business|accounts)\.dump$/, '');
    const stamps = [...new Set(all.map(stampOf))].sort();
    const keep = new Set(stamps.slice(-BACKUPS_KEPT));
    const old = all.filter((k) => !keep.has(stampOf(k)));
    await deletePrivateFiles(bucket, old);
    return { status: 'saved', keys, bytes, deleted: old.length };
  } finally {
    for (const part of files) await rm(part.file, { force: true });
  }
}

function pgDump(url: string, file: string, extra: string[]): Promise<void> {
  const args = [
    '--format=custom', // compressed; restore with pg_restore
    '--no-owner',
    '--no-privileges',
    ...extra,
    `--file=${file}`,
    `--dbname=${url}`,
  ];
  return new Promise((resolve, reject) => {
    // Errors are kept, the arguments (with the connection string) are never logged.
    const child = spawn('pg_dump', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-2000);
    });
    child.on('error', (error) =>
      reject(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error('pg_dump is not installed in this image')
          : error,
      ),
    );
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`pg_dump failed (${code}): ${errors.trim()}`)),
    );
  });
}

/** Worker job: weekly backup. */
export async function handleDatabaseBackup(): Promise<void> {
  const result = await runDatabaseBackup();
  if (result.status === 'skipped') console.info(`[worker] backup skipped: ${result.reason}`);
  else
    console.info(
      `[worker] backup saved (${Math.round(result.bytes / 1024)} KB), ${result.deleted} old removed`,
    );
}
